import dotenv from "dotenv";
import { Keypair } from "@solana/web3.js";

dotenv.config({ override: true });
import bs58 from "bs58";

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

const loadKeypair = (secret: string): Keypair => {
  try {
    return Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    throw new Error("WALLET_SECRET is not a valid base58-encoded secret key");
  }
};

const region = parseRegion(optional("JITO_REGION", "frankfurt"));

const blockEngineUrl =
  region === "mainnet"
    ? "https://mainnet.block-engine.jito.wtf"
    : `https://${region}.mainnet.block-engine.jito.wtf`;

export const config = {
  rpc: {
    http: required("RPC_HTTP_URL"),
    wss: process.env.RPC_WSS_URL,
  },
  grpc: {
    url: required("GRPC_URL"),
    token: process.env.GRPC_TOKEN ?? "",
  },
  jito: {
    region,
    blockEngineUrl,
    tipFloorUrl: "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
  },
  wallet: loadKeypair(required("WALLET_SECRET")),
  ai: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("AI_MODEL", "claude-sonnet-4-6"),
  },
  tuning: {
    leaderWindowSlots: int("LEADER_WINDOW_SLOTS", 3),
    maxTipLamports: int("MAX_TIP_LAMPORTS", 100_000),
    probeTransferLamports: int("PROBE_TRANSFER_LAMPORTS", 1_000),
  },
} as const;

export type AppConfig = typeof config;
