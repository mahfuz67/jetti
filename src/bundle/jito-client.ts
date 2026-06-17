import { config } from "@/config/env";

interface RpcOk<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface RpcErr {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
}

export interface InflightStatus {
  bundle_id: string;
  status: "Invalid" | "Pending" | "Failed" | "Landed";
  landed_slot: number | null;
}

interface WithValue<T> {
  context: { slot: number };
  value: T[];
}

const endpoint = `${config.jito.blockEngineUrl}/api/v1/bundles`;

let nextId = 1;

const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  if (!res.ok) {
    throw new Error(`Jito ${method} HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as RpcOk<T> | RpcErr;
  if ("error" in body) {
    throw new JitoRpcError(method, body.error.code, body.error.message);
  }
  return body.result;
};

export class JitoRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`Jito ${method} error ${code}: ${message}`);
    this.name = "JitoRpcError";
  }
}

export const getTipAccounts = (): Promise<string[]> =>
  rpc<string[]>("getTipAccounts", []);

export const sendBundle = (base64Txs: string[]): Promise<string> =>
  rpc<string>("sendBundle", [base64Txs, { encoding: "base64" }]);

export const getInflightBundleStatuses = (
  bundleIds: string[],
): Promise<WithValue<InflightStatus>> =>
  rpc<WithValue<InflightStatus>>("getInflightBundleStatuses", [bundleIds]);
