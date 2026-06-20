# Jetti web demo

A small Next.js app showing live usage of the [`jetti`](../..) SDK — submit a bundle and
watch every commitment stage stream in, track any signature, and read the live tip
floor / congestion.

## Run

```bash
# from the repo root, build the SDK once (the demo imports its dist build):
yarn build

# then start the demo:
cd examples/web
yarn install
yarn dev            # http://localhost:3000
```

## How it works

The SDK runs **server-side** — Node-runtime route handlers (`src/app/api/*`) hold a single
`Jetti` instance and stream `JettiEvent`s to the browser over SSE. The wallet secret and
Anthropic key stay on the server and never reach the client.

It's an **operator control panel**, not a multi-user dApp: it drives the one hot wallet from
the repo's `.env`. That's deliberate — Jetti's autonomous AI retry re-signs each attempt
server-side, which a browser-connected wallet couldn't do.

The SDK is resolved from the repo's `dist/` build via a webpack alias (`next.config.mjs`),
so the SDK must be built first.
