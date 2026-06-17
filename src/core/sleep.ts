export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const withBackoff = (
  attempt: number,
  baseMs = 500,
  maxMs = 15_000,
): number =>
  Math.min(maxMs, baseMs * 2 ** attempt) + Math.floor(Math.random() * 250);
