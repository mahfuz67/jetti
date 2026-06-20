import type { JettiContext } from "@/context";

const SLOTS_PER_LEADER = 4;
const FETCH_AHEAD = 128;
const PREFETCH_AT = 16;

export interface LeaderWindow {
  currentSlot: number;
  currentLeader: string | null;
  // Slots left in the current leader's 4-slot turn. We treat all leaders as
  // Jito-capable (>95% of stake runs jito-solana), so this is the timing signal:
  // submit early in a turn to leave room for the bundle auction + inclusion.
  slotsRemainingInTurn: number;
  windowOpen: boolean;
}

export interface LeaderCache {
  startSlot: number;
  leaders: string[];
}

const fetchLeaders = async (
  ctx: JettiContext,
  slot: number,
): Promise<LeaderCache> => {
  const leaders = (await ctx.connection.getSlotLeaders(slot, FETCH_AHEAD)).map(
    (p) => p.toBase58(),
  );
  return { startSlot: slot, leaders };
};

const ensureLeaders = async (
  ctx: JettiContext,
  slot: number,
): Promise<LeaderCache> => {
  const c = ctx.caches.leader;
  const cache = c.value;
  const haveRange =
    cache &&
    slot >= cache.startSlot &&
    slot < cache.startSlot + cache.leaders.length - SLOTS_PER_LEADER;

  if (haveRange && cache) {
    const remaining = cache.startSlot + cache.leaders.length - slot;
    if (remaining <= PREFETCH_AT + SLOTS_PER_LEADER && !c.prefetching) {
      c.prefetching = true;
      void fetchLeaders(ctx, slot)
        .then((next) => {
          c.value = next;
        })
        .catch(() => {})
        .finally(() => {
          c.prefetching = false;
        });
    }
    return cache;
  }

  c.value = await fetchLeaders(ctx, slot);
  return c.value;
};

export const leaderWindowAt = async (
  ctx: JettiContext,
  currentSlot: number,
): Promise<LeaderWindow> => {
  const { startSlot, leaders } = await ensureLeaders(ctx, currentSlot);
  const offset = currentSlot - startSlot;
  const currentLeader = leaders[offset] ?? null;

  const slotsRemainingInTurn =
    SLOTS_PER_LEADER - (currentSlot % SLOTS_PER_LEADER);
  const windowOpen =
    slotsRemainingInTurn >= ctx.config.tuning.leaderWindowSlots;

  return { currentSlot, currentLeader, slotsRemainingInTurn, windowOpen };
};
