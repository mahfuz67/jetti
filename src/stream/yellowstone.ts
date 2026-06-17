import { EventEmitter } from "node:events";
import YellowstoneClient, {
  CommitmentLevel,
  type SubscribeRequest,
  type SubscribeUpdate,
} from "@triton-one/yellowstone-grpc";
import type { ClientDuplexStream } from "@grpc/grpc-js";
import bs58 from "bs58";
import { config } from "@/config/env";
import { child } from "@/core/logger";
import { sleep, withBackoff } from "@/core/sleep";

const log = child({ mod: "stream" });

// @triton-one/yellowstone-grpc ships as CommonJS (`exports.default = Client`).
// Under Node's ESM interop the default import resolves to the module namespace,
// so the real constructor lives on `.default`; fall back to the import for CJS.
const ClientCtor =
  (YellowstoneClient as unknown as { default?: typeof YellowstoneClient })
    .default ?? YellowstoneClient;

export type SlotStatus = "processed" | "confirmed" | "finalized";

export interface SlotEvent {
  slot: number;
  status: SlotStatus;
}

export interface TxEvent {
  signature: string;
  slot: number;
  err: unknown;
}

const STATUS_BY_CODE: Record<number, SlotStatus> = {
  0: "processed",
  1: "confirmed",
  2: "finalized",
};

// ts-proto's encoder calls Object.entries() on every map field, so a request
// with any map left undefined fails serialization ("Cannot convert undefined or
// null to object"). Every write — including pings — must carry these empties.
const EMPTY_REQUEST: SubscribeRequest = {
  accounts: {},
  slots: {},
  transactions: {},
  transactionsStatus: {},
  blocks: {},
  blocksMeta: {},
  entry: {},
  accountsDataSlice: [],
};

const buildRequest = (walletBase58: string): SubscribeRequest => ({
  ...EMPTY_REQUEST,
  slots: { client: { filterByCommitment: false } },
  transactions: {
    self: {
      accountInclude: [walletBase58],
      accountExclude: [],
      accountRequired: [],
      // Non-vote only. `failed` is deliberately left unset: setting it filters to
      // a single outcome (`true` = only failed, `false` = only succeeded). We need
      // BOTH — successful landings to confirm, failures to classify.
      vote: false,
      failed: undefined,
    },
  },
  commitment: CommitmentLevel.PROCESSED,
});

export interface YellowstoneStream {
  on(event: "slot", listener: (e: SlotEvent) => void): this;
  on(event: "transaction", listener: (e: TxEvent) => void): this;
  on(event: "connect", listener: () => void): this;
  on(event: "disconnect", listener: (err: unknown) => void): this;
  once(event: "connect", listener: () => void): this;
}

export class YellowstoneStream extends EventEmitter {
  private client: YellowstoneClient | null = null;
  private stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate> | null =
    null;
  private pingTimer: NodeJS.Timeout | null = null;
  private running = false;
  private attempt = 0;

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.connect();
        this.attempt = 0;
        await this.consume();
      } catch (err) {
        this.emit("disconnect", err);
        if (!this.running) break;
        const delay = withBackoff(this.attempt++);
        log.warn(
          { err: String(err), delay, attempt: this.attempt },
          "stream error, reconnecting",
        );
        await sleep(delay);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.clearPing();
    this.stream?.end();
    this.stream = null;
  }

  private async connect(): Promise<void> {
    this.client = new ClientCtor(
      config.grpc.url,
      config.grpc.token || undefined,
      undefined,
    );
    this.stream = await this.client.subscribe();
    await this.write(buildRequest(config.wallet.publicKey.toBase58()));
    this.startPing();
    this.emit("connect");
    log.info({ url: config.grpc.url }, "yellowstone connected");
  }

  private async consume(): Promise<void> {
    const stream = this.stream;
    if (!stream) throw new Error("stream not initialized");

    // Async iteration pulls one update at a time, so a slow consumer pauses the
    // gRPC source instead of buffering unbounded — natural backpressure. A stream
    // error throws out of the loop and is handled by the reconnect supervisor.
    try {
      for await (const update of stream as AsyncIterable<SubscribeUpdate>) {
        this.onUpdate(update);
      }
    } finally {
      this.clearPing();
    }
  }

  private onUpdate(update: SubscribeUpdate): void {
    if (update.slot) {
      // Only the three commitment statuses (0/1/2) drive the lifecycle. Newer
      // Geyser builds emit extra slot statuses (FirstShredReceived, Dead, …);
      // ignore those rather than mislabelling them as `processed`.
      const status = STATUS_BY_CODE[update.slot.status ?? -1];
      if (status) this.emit("slot", { slot: Number(update.slot.slot), status });
    }

    if (update.transaction?.transaction) {
      const tx = update.transaction.transaction;
      const sigBytes = tx.signature;
      if (sigBytes) {
        this.emit("transaction", {
          signature: encodeSignature(sigBytes),
          slot: Number(update.transaction.slot),
          err: tx.meta?.err ?? null,
        });
      }
    }

    if (update.ping) this.writePing();
  }

  // Pings keep the duplex stream alive. Must carry the empty maps (see
  // EMPTY_REQUEST) or the request fails to serialize.
  private writePing(): void {
    this.stream?.write({ ...EMPTY_REQUEST, ping: { id: 1 } }, () => {});
  }

  private startPing(): void {
    this.clearPing();
    this.pingTimer = setInterval(() => this.writePing(), 15_000);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private write(request: SubscribeRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream?.write(request, (err: unknown) =>
        err ? reject(err) : resolve(),
      );
    });
  }
}

const encodeSignature = (bytes: Uint8Array): string => bs58.encode(bytes);
