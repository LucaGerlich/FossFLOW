import type { TrafficSummary } from './wire.js';

export const SUMMARY_CACHE_MS = 5_000;

type Entry = { at: number; summary: Promise<TrafficSummary> };

/**
 * Shares one summary per project for a few seconds, so every open editor
 * polling does not cost its own scan. The promise is stored, so concurrent
 * requests share one query; a failed query is evicted.
 */
// ponytail: single-process cache; move it if FossFLOW ever runs as several instances.
export const createSummaryCache = (
  compute: (projectId: string, now: Date) => Promise<TrafficSummary>,
  ttlMs: number = SUMMARY_CACHE_MS
): ((projectId: string, now: Date) => Promise<TrafficSummary>) => {
  const entries = new Map<string, Entry>();
  return (projectId, now) => {
    const nowMs = now.getTime();
    const cached = entries.get(projectId);
    if (cached && nowMs - cached.at < ttlMs) return cached.summary;
    // Drop expired projects so the map cannot grow without bound.
    for (const [id, entry] of entries) {
      if (nowMs - entry.at >= ttlMs) entries.delete(id);
    }
    const summary = compute(projectId, now);
    const entry: Entry = { at: nowMs, summary };
    entries.set(projectId, entry);
    summary.catch(() => {
      if (entries.get(projectId) === entry) entries.delete(projectId);
    });
    return summary;
  };
};
