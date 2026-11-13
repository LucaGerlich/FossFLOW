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
