import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { TipPercentileKey } from "@/tip/recommend";

const JITO_REGIONS = [
  "mainnet",
  "amsterdam",
  "dublin",
  "frankfurt",
  "london",
  "ny",
  "slc",
  "singapore",
  "tokyo",
] as const;

export type JitoRegion = (typeof JITO_REGIONS)[number];

export interface JettiConfig {
  rpc: { http: string; wss?: string };
  grpc: { url: string; token: string };
  jito: { region: JitoRegion; blockEngineUrl: string; tipFloorUrl: string };
  wallet: Keypair;
  ai: { apiKey: string; model: string };
  tuning: {
    leaderWindowSlots: number;
    maxTipLamports: number;
    probeTransferLamports: number;
    baseTipPercentile: TipPercentileKey;
  };
}

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`Env var ${key} must be an integer, got "${raw}"`);
  return parsed;
};

const parseRegion = (raw: string): JitoRegion => {
  if ((JITO_REGIONS as readonly string[]).includes(raw))
    return raw as JitoRegion;
  throw new Error(
    `JITO_REGION must be one of ${JITO_REGIONS.join(", ")}, got "${raw}"`,
  );
};

const TIP_PERCENTILES = ["p25", "p50", "p75", "p95", "p99"] as const;

const parseTipPercentile = (raw: string): TipPercentileKey => {
  if ((TIP_PERCENTILES as readonly string[]).includes(raw))
    return raw as TipPercentileKey;
  throw new Error(
    `BASE_TIP_PERCENTILE must be one of ${TIP_PERCENTILES.join(", ")}, got "${raw}"`,
  );
};

const loadKeypair = (secret: string): Keypair => {
  try {
    return Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    throw new Error("WALLET_SECRET is not a valid base58-encoded secret key");
  }
};

const blockEngineUrlFor = (region: JitoRegion): string =>
  region === "mainnet"
    ? "https://mainnet.block-engine.jito.wtf"
    : `https://${region}.mainnet.block-engine.jito.wtf`;

// Walk up from the cwd so a single repo-root .env is found whether a command runs
// from the root or from inside a workspace package.
const findEnvFile = (): string | undefined => {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};

export const loadConfigFromEnv = (): JettiConfig => {
  const path = findEnvFile();
  dotenv.config(path ? { path, override: true } : { override: true });

  const region = parseRegion(optional("JITO_REGION", "frankfurt"));
  return {
    rpc: { http: required("RPC_HTTP_URL"), wss: process.env.RPC_WSS_URL },
    grpc: { url: required("GRPC_URL"), token: process.env.GRPC_TOKEN ?? "" },
    jito: {
      region,
      blockEngineUrl: blockEngineUrlFor(region),
      tipFloorUrl: "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
    },
    wallet: loadKeypair(required("WALLET_SECRET")),
    ai: {
      apiKey: required("ANTHROPIC_API_KEY"),
      model: optional("AI_MODEL", "claude-haiku-4-5-20251001"),
    },
    tuning: {
      leaderWindowSlots: int("LEADER_WINDOW_SLOTS", 3),
      maxTipLamports: int("MAX_TIP_LAMPORTS", 100_000),
      probeTransferLamports: int("PROBE_TRANSFER_LAMPORTS", 1_000),
      baseTipPercentile: parseTipPercentile(
        optional("BASE_TIP_PERCENTILE", "p75"),
      ),
    },
  };
};
