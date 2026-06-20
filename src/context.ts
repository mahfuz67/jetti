import type { Connection, PublicKey } from "@solana/web3.js";
import Anthropic from "@anthropic-ai/sdk";
import type { JettiConfig } from "@/config/env";
import { createConnection } from "@/core/connection";
import type { CachedBlockhash } from "@/core/blockhash";
import type { CongestionSignal } from "@/tip/recommend";
import type { LeaderCache } from "@/leader/schedule";
import type { TipPercentiles } from "@/core/types";

export interface Caches {
  blockhash: { value: CachedBlockhash | null; timer: ReturnType<typeof setInterval> | null };
  tipFloor: { value: TipPercentiles | null };
  congestion: { value: CongestionSignal | null; at: number };
  leader: { value: LeaderCache | null; prefetching: boolean };
  tipAccounts: { value: PublicKey[] | null; at: number };
}

export interface Stats {
  outcomes: boolean[];
  confirmDeltas: number[];
}

export interface JettiContext {
  config: JettiConfig;
  connection: Connection;
  ai: Anthropic;
  caches: Caches;
  stats: Stats;
}

const createCaches = (): Caches => ({
  blockhash: { value: null, timer: null },
  tipFloor: { value: null },
  congestion: { value: null, at: 0 },
  leader: { value: null, prefetching: false },
  tipAccounts: { value: null, at: 0 },
});

const createStats = (): Stats => ({ outcomes: [], confirmDeltas: [] });

export const createContext = (config: JettiConfig): JettiContext => ({
  config,
  connection: createConnection(config),
  ai: new Anthropic({ apiKey: config.ai.apiKey }),
  caches: createCaches(),
  stats: createStats(),
});
