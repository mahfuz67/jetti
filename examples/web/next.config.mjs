import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK's native deps stay external (resolved from the root node_modules at
  // runtime); `jetti` itself is bundled from the local build via the alias below.
  serverExternalPackages: [
    "@triton-one/yellowstone-grpc",
    "@grpc/grpc-js",
    "@anthropic-ai/sdk",
    "pino",
    "pino-pretty",
  ],
  webpack: (config) => {
    config.resolve.alias.jetti = resolve(here, "../../dist/index.js");
    return config;
  },
};

export default nextConfig;
