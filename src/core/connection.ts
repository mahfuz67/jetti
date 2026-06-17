import { Connection } from "@solana/web3.js";
import { config } from "@/config/env";

export const connection = new Connection(config.rpc.http, {
  commitment: "confirmed",
  ...(config.rpc.wss ? { wsEndpoint: config.rpc.wss } : {}),
});
