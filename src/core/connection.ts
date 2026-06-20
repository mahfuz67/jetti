import { Connection } from "@solana/web3.js";
import type { JettiConfig } from "@/config/env";

export const createConnection = (config: JettiConfig): Connection =>
  new Connection(config.rpc.http, {
    commitment: "confirmed",
    ...(config.rpc.wss ? { wsEndpoint: config.rpc.wss } : {}),
  });
