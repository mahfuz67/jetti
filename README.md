# Jetti

**Jetti** is an infrastructure-grade Solana transaction stack that observes the network in real time, submits Jito bundles intelligently, tracks every transaction across all commitment levels, classifies failures, and lets an **AI agent own the retry decision** autonomously.

Built for the *Advanced Infrastructure Challenge — Build a Smart Transaction Stack*.

- **Streaming:** Yellowstone gRPC (slots at every commitment level + our own transactions), consumed via async iteration for natural backpressure, with reconnection and resubscribe on error.
- **Submission:** real Jito bundles via the Block Engine JSON-RPC (`sendBundle`), gated on a detected leader window (the orchestrator holds until enough of a leader's turn remains before sending), with the tip computed dynamically from the live tip-floor API and network congestion — no hardcoded tips.
- **Lifecycle:** stream-driven state machine (`submitted → processed → confirmed → finalized`) capturing slot numbers, timestamps, and latency deltas.
- **Failures:** classified into `EXPIRED_BLOCKHASH`, `FEE_TOO_LOW`, `COMPUTE_EXCEEDED`, `BUNDLE_FAILED`, `NOT_LANDED`.
- **AI agent:** on failure, a Claude agent reasons over a live snapshot and decides whether to retry, whether to refresh the blockhash, the new tip, and whether to wait for a leader window. The retry flow is **not** hardcoded.

> Network note: Jito's Block Engine runs on **mainnet** and testnet only — there is no devnet Block Engine. This stack runs on **mainnet** using minimal self-transfer probe transactions and tips near the floor, so a full lifecycle run costs a fraction of a cent.

## Architecture

The full design — system architecture, components, data flow, infrastructure decisions, failure-handling strategy, and the AI agent's responsibilities — is in the public architecture document:

**📐 Architecture document:** https://gist.github.com/mahfuz67/75c162806395bcc4c01440f07afe1ea6

```
Yellowstone gRPC ─► stream/ ─► leader/        ┐
Jito tip_floor   ─► tip/                       │  core transaction stack
                    bundle/ ─► Jito Block Engine
                    lifecycle/ ─► failure/ ─► logs/
                              │snapshot   ▲decision
                              ▼           │
                            ai/  (Claude retry controller)  ┘
```

The AI layer is isolated: `ai/agent.ts` is a pure `snapshot → decision` function and imports nothing from `stream/` or `bundle/` — only shared types. The core stack executes whatever the agent decides; it never hardcodes retry logic.

## Module map

| Path | Responsibility |
|---|---|
| `src/config/env.ts` | Typed env + endpoints + keypair loading |
| `src/stream/yellowstone.ts` | gRPC client: slot + tx subscription, ping keepalive, reconnect/backoff |
| `src/leader/schedule.ts` | Leader schedule cache + submission-window detection (enforced as a pre-send gate in the orchestrator) |
| `src/tip/tip-floor.ts`, `src/tip/recommend.ts` | Live tip percentiles + congestion-aware base tip |
| `src/bundle/jito-client.ts`, `build.ts`, `tip-accounts.ts` | Bundle construction + Block Engine JSON-RPC |
| `src/lifecycle/tracker.ts` | Stream-driven commitment state machine + latency deltas |
| `src/failure/classify.ts` | Failure classification (pure) |
| `src/ai/agent.ts` | Claude retry controller (pure snapshot → decision) |
| `src/faultinject/blockhash.ts` | Deliberate blockhash-expiry fault injection |
| `src/retry/orchestrator.ts` | Submit → track → classify → AI decide → retry loop |
| `src/logs/` | JSONL lifecycle log + pretty renderer |

## Setup

Requires Node ≥ 20 and Yarn (Classic, 1.x).

```bash
yarn install
cp .env.example .env
# fill in .env (see below)
```

Generate a dedicated mainnet hot wallet (fund it with a small amount of SOL, e.g. 0.02):

```bash
solana-keygen new -o keys/hot.json
solana address -k keys/hot.json
# export the base58 secret into WALLET_SECRET in .env
```

`.env` fields:

| Var | Meaning |
|---|---|
| `RPC_HTTP_URL` / `RPC_WSS_URL` | Mainnet RPC (Helius / Triton / QuickNode / SolInfra) |
| `GRPC_URL` / `GRPC_TOKEN` | Yellowstone gRPC endpoint + auth token |
| `JITO_REGION` | Lowest-latency Block Engine region (`frankfurt`, `ny`, `amsterdam`, …) |
| `WALLET_SECRET` | base58 secret key of the hot wallet |
| `ANTHROPIC_API_KEY` / `AI_MODEL` | Claude credentials for the agent |
| `MAX_TIP_LAMPORTS` | Hard ceiling the agent may never exceed (cost guardrail) |

## Running

```bash
yarn stream        # prove streaming: live slots, reconnection
yarn bundle:one    # submit one bundle and watch its full lifecycle
yarn demo:fault    # inject a blockhash expiry; watch the AI agent recover
yarn batch         # produce the lifecycle log (10+ bundles, incl. faults)
yarn typecheck
yarn test          # pure-core unit tests (classifier, tip math)
```

Lifecycle logs are written to `logs/lifecycle-<date>.jsonl`. The `logs/` directory is
gitignored scratch space; to produce the **committed submission artifact**, point
`LOG_DIR` at the tracked `logs/samples/` path:

```bash
LOG_DIR=logs/samples yarn batch    # writes logs/samples/lifecycle-<date>.jsonl (committed)
```

Every entry carries slot numbers verifiable on Solscan / Solana Explorer, the commitment
progression with timestamps, the per-stage latency `deltas`, the tip amount per attempt,
and the failure classification + AI reasoning where applicable. One entry per line; each
is a `BundleLifecycle` with a `signature` + `landedSlot` judges can paste into an explorer.

## AI agent: how the decision is real, not a wrapper

When a bundle fails, the orchestrator builds a `NetworkSnapshot` — failure class, blockhash age vs. validity, live tip percentiles, our recent land rate, leader-window state, attempt number — and hands it to the Claude agent. The agent returns strict JSON **plus a free-text `reasoning` field that is logged verbatim**:

```json
{"action":"RETRY","refreshBlockhash":true,"newTipLamports":18342,"waitForLeaderWindow":false,
 "reasoning":"Blockhash expired (age beyond validity); a refresh is mandatory and tip alone won't help. Tip was already above p50, so I keep it near current p50 rather than overpaying."}
```

Different snapshots produce different decisions: an expiry forces a refresh; a `FEE_TOO_LOW` raises the tip toward a higher percentile; a `COMPUTE_EXCEEDED` aborts (no retry can fix it); a closed leader window makes the agent wait. The orchestrator executes exactly what the agent returns — it contains no `if failure == X then Y` retry policy of its own. The tip the agent picks is clamped to `MAX_TIP_LAMPORTS` as a safety bound, not a decision.

---

## Lessons from running on mainnet

These are observations from actually operating the stack on mainnet, not theory. `yarn report` regenerates the aggregate figures from the committed lifecycle log.

**1. "Submitted to Jito" ≠ "landed on-chain."** A successful `sendBundle` (returning a `bundleId`) tells you nothing about inclusion — only the stream/chain does. In one run, attempts 1–2 (tips 2,810 / 5,878 lamports) lost the Jito auction and produced *no on-chain transaction at all*, while attempt 3 (10,000 lamports) landed and finalized at slot `426924880`. The stack reports exactly one wallet transaction for that bundle, which is correct. Conflating submission with landing is the most common way these systems lie to you.

**2. The tip floor is bimodal and spikes violently.** In calm conditions we observed p50 ≈ 2,500–5,000 lamports, but during a live congestion event p95 jumped to **650,341** and p99 to **1,000,000** lamports within minutes — a ~200× spread between median and tail. The practical consequence: a fixed tip is useless, *and* a cost ceiling (`MAX_TIP_LAMPORTS`) becomes a binding constraint exactly when you most want to land. That cost-vs-landing tradeoff is real, not hypothetical — we watched the agent bump against the 100k ceiling while p95 sat far above it.

**3. Finalization lag is real and measurable.** Our logs show `confirmed → finalized` ≈ **12.2 s** (~32 slots) against `processed → confirmed` ≈ **266 ms**. That two-orders-of-magnitude gap is exactly why we fetch blockhashes at `confirmed` (Q2) and treat `confirmed` as "landed" rather than waiting on finalization (Q1).

**4. Jito rate-limits globally under load.** During the same congestion event, `sendBundle` returned `HTTP 429: globally rate limited`. Landing probability collapses during network-wide events regardless of your tip; the stack classifies the failure and the agent continues rather than crashing.

**5. Stream confirmation has sharp edges (debugging notes).** Three issues that only surface by running the stack against a live Geyser endpoint:
- Yellowstone's transaction filter `failed: true` delivers **only failed** transactions — so successful landings were silently filtered out and every bundle looked failed until we left `failed` unset to receive both outcomes.
- `@triton-one/yellowstone-grpc` (1.4.x) serializes every map field, so a *bare* ping request (maps left `undefined`) throws `Cannot convert undefined or null to object` and kills the stream. Every written request — pings included — must carry the empty maps.
- The package ships as CommonJS; under ESM the default import resolves to the module namespace, so the constructor lives on `.default`.

**Aggregate run stats** (`yarn report` over the committed log): land rate `<fill>`%, median `processed→confirmed` `<fill>` ms, median `confirmed→finalized` `<fill>` ms, failures by class `<fill>`.

---

## README questions

### Q1 — What does the delta between `processed_at` and `confirmed_at` tell you about network health?

`processed` means a leader put the transaction in a block on the fork it was building. `confirmed` means that block has been voted on by a supermajority (≥ 2/3 of stake) — i.e. it is no longer just one leader's optimistic fork, it has cluster agreement. So the **processed → confirmed delta is a direct measure of vote-propagation and consensus latency at that moment**, which is the most sensitive indicator of network health available to a submitter.

- A small, stable delta (observed in our logs as a couple hundred ms / one–few slots) means votes are propagating cleanly, the cluster is well-synced, fork-rate is low, and the slot the tx landed in was on the heavy fork from the start.
- A large or spiky delta means the network is unhealthy: congestion delaying vote transactions, gossip/turbine propagation lag, skipped slots, or fork churn where the tx's slot was briefly on a minority fork and had to wait for the cluster to converge before it could accumulate confirming votes.

Operationally we feed it to the agent as a live congestion gauge: the median recent processed→confirmed latency is passed in the `NetworkSnapshot` as `recentProcessedToConfirmedMs`, and the agent is instructed that a rising value means the cluster is stressed — biasing it toward a higher tip and/or waiting for a clean leader window, while a low, stable value tells it not to overpay. (The per-stage `deltas` are also persisted on every attempt in the lifecycle log.)

### Q2 — Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?

A blockhash is only valid for ~150 blocks (~60–90s) after the block it came from. The commitment level you request determines **how old that block already is when you receive it**:

- `finalized` returns a blockhash from a block that is already ≥ 31+ slots in the past (finalization lag). You've therefore burned ~13+ seconds of the validity window before you even sign and submit.
- `confirmed` (or `processed`) returns the freshest possible blockhash, giving you nearly the entire ~150-block window to land.

Fetching at `finalized` needlessly shortens your runway, dramatically raising the probability of an `EXPIRED_BLOCKHASH` failure — exactly the failure our fault injector reproduces and the agent recovers from. For anything time-sensitive (and a Jito bundle competing for a leader slot is the definition of time-sensitive), fetch the blockhash at `confirmed`. We fetch with `confirmed` everywhere in `getBlockhash()` for this reason.

### Q3 — What happens to your bundle if the Jito leader skips their slot?

A bundle is atomic and **bound to a specific leader's block**. If the scheduled Jito leader skips (fails to produce) their slot, your bundle is **not included in that slot** — it does not land, and crucially it does **not** land partially: it's all-or-nothing, so either every transaction executes in that block or none do.

Crucially, a bundle is **not** durably queued across many future leaders: it targets the current leader's auction/slot window and has a short lifespan. If that leader skips, the bundle only has a chance in an immediately-following slot *if* another Jito leader is up while your blockhash is still valid — there is no long-lived forwarding. In practice a skip usually means the bundle simply doesn't land. If leaders keep skipping (or no Jito leader produces a block) until the blockhash's `lastValidBlockHeight` passes, the bundle expires and you get nothing back on-chain — you must refresh the blockhash, recompute the tip, and resubmit. This is precisely the recovery path the AI agent owns: it observes the non-landing, classifies it, and decides to refresh + re-tip + resubmit rather than blindly retrying with a dead blockhash.

---

## Lifecycle log

`logs/lifecycle-<date>.jsonl` contains ≥ 10 real bundle submissions including ≥ 2 failure cases (two are forced via blockhash-expiry injection to exercise the agent; others fail naturally when no leader window lands them in time). Each line is one `BundleLifecycle` with per-attempt slots, commitment stages + timestamps, tip amounts, failure class, and the AI decision/reasoning. Judges can paste any `landedSlot` / signature into an explorer to confirm the stack ran on real infrastructure.
