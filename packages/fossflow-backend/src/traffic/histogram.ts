/**
 * Upper bounds (ms, inclusive) of the duration buckets; one more bucket
 * counts everything slower than the last bound.
 *
 * This is a stored format: never reorder it. Appending a bound needs a migration.
 */
export const DURATION_BOUNDS_MS = [
  5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 30000
] as const;

/** The bucket index for a duration: the first bound it does not exceed, else the overflow bucket. */
export const bucketOf = (ms: number): number => {
  const index = DURATION_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return index === -1 ? DURATION_BOUNDS_MS.length : index;
};

export const emptyHistogram = (): number[] => new Array<number>(DURATION_BOUNDS_MS.length + 1).fill(0);

/**
 * The `q` quantile (0..1) of a duration histogram, interpolated linearly inside
 * the bucket that holds rank `q × total`. Null without calls; the overflow
 * bucket answers with the last bound.
 */
export const percentileMs = (histogram: readonly number[], q: number): number | null => {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const rank = q * total;
  let before = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    const count = histogram[index] ?? 0;
    if (count > 0 && before + count >= rank) {
      if (index >= DURATION_BOUNDS_MS.length) return DURATION_BOUNDS_MS[DURATION_BOUNDS_MS.length - 1] ?? null;
      const lower = index === 0 ? 0 : (DURATION_BOUNDS_MS[index - 1] ?? 0);
      const upper = DURATION_BOUNDS_MS[index] ?? lower;
      return lower + (upper - lower) * ((rank - before) / count);
    }
    before += count;
  }
  return DURATION_BOUNDS_MS[DURATION_BOUNDS_MS.length - 1] ?? null;
};
