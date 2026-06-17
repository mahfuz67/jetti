import { connection } from "@/core/connection";
import { config } from "@/config/env";

const SLOTS_PER_LEADER = 4;
const FETCH_AHEAD = 128;

export interface LeaderWindow {
  currentSlot: number;
  currentLeader: string | null;
  // Slots left in the current leader's 4-slot turn. We treat all leaders as
  // Jito-capable (>95% of stake runs jito-solana), so this is the timing signal:
  // submit early in a turn to leave room for the bundle auction + inclusion.
  slotsRemainingInTurn: number;
  windowOpen: boolean;
}

interface LeaderCache {
  startSlot: number;
  leaders: string[];
}

let cache: LeaderCache | null = null;

const ensureLeaders = async (slot: number): Promise<LeaderCache> => {
  const haveRange =
    cache &&
    slot >= cache.startSlot &&
    slot < cache.startSlot + cache.leaders.length - SLOTS_PER_LEADER;
  if (haveRange && cache) return cache;

  const leaders = (await connection.getSlotLeaders(slot, FETCH_AHEAD)).map(
    (p) => p.toBase58(),
  );
  cache = { startSlot: slot, leaders };
  return cache;
};

export const leaderWindowAt = async (
  currentSlot: number,
): Promise<LeaderWindow> => {
  const { startSlot, leaders } = await ensureLeaders(currentSlot);
  const offset = currentSlot - startSlot;
  const currentLeader = leaders[offset] ?? null;

  const slotsRemainingInTurn =
    SLOTS_PER_LEADER - (currentSlot % SLOTS_PER_LEADER);
  const windowOpen = slotsRemainingInTurn >= config.tuning.leaderWindowSlots;

  return { currentSlot, currentLeader, slotsRemainingInTurn, windowOpen };
};
