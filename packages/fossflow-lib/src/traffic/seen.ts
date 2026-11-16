import { trafficIdentity } from 'src/schemas/common';
import type { Connector } from 'src/types';
import { boxOf, findArrow, type TrafficIndex } from './match';
import type { TrafficSummary } from './types';

export const MAX_SEEN = 50;

export interface UnplacedEntry {
  identity: string;
  calls: number;
  lastSeenAt: string;
}

export interface UnconnectedEntry {
  fromItemId: string;
  toItemId: string;
  calls: number;
}

export interface SeenEntries {
  unplaced: UnplacedEntry[];
  unconnected: UnconnectedEntry[];
}

/** Most calls first, then most recently seen. */
const byCallsThenRecent = (
  a: { calls: number; lastSeenAt: string },
  b: { calls: number; lastSeenAt: string }
): number =>
  b.calls - a.calls || (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0);

const unplacedOf = (
  summary: TrafficSummary,
  index: TrafficIndex
): UnplacedEntry[] => {
  const aliasHosts = new Set(summary.aliases.map((alias) => alias.host));
  const seen = new Map<string, UnplacedEntry>();
  const note = (identity: string, calls: number, lastSeenAt: string): void => {
    if (aliasHosts.has(identity) || boxOf(index, identity) !== null) return;
    // A name the binding schema rejects could never be saved, so never offer it.
    if (!trafficIdentity.safeParse(identity).success) return;
    const entry = seen.get(identity);
    if (!entry) {
      seen.set(identity, { identity, calls, lastSeenAt });
      return;
    }
    entry.calls += calls;
    if (lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = lastSeenAt;
  };

  for (const edge of summary.edges) {
    note(edge.caller, edge.calls, edge.lastSeenAt);
    note(edge.callee, edge.calls, edge.lastSeenAt);
  }
  // Identities that only appear in the per-callee or per-service totals.
  const edgeIdentities = new Set(
    summary.edges.flatMap((edge) => [edge.caller, edge.callee])
  );
  for (const { callee, calls } of summary.callees) {
    if (!edgeIdentities.has(callee)) note(callee, calls, summary.generatedAt);
  }
  for (const { service, calls } of summary.services) {
    if (!edgeIdentities.has(service)) note(service, calls, summary.generatedAt);
  }
  return [...seen.values()].sort(byCallsThenRecent).slice(0, MAX_SEEN);
};

const unconnectedOf = (
  summary: TrafficSummary,
  index: TrafficIndex,
  connectors: Connector[]
): UnconnectedEntry[] => {
  const pairs = new Map<string, UnconnectedEntry & { lastSeenAt: string }>();
  for (const edge of summary.edges) {
    const from = boxOf(index, edge.caller);
    const to = boxOf(index, edge.callee);
    if (from === null || to === null || from === to) continue;
    if (findArrow(connectors, from, to)) continue;
    const key = [from, to].sort().join('\u0000');
    const entry = pairs.get(key);
    if (!entry) {
      pairs.set(key, {
        fromItemId: from,
        toItemId: to,
        calls: edge.calls,
        lastSeenAt: edge.lastSeenAt
      });
      continue;
    }
    entry.calls += edge.calls;
    if (edge.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = edge.lastSeenAt;
  }
  return [...pairs.values()]
    .sort(byCallsThenRecent)
    .slice(0, MAX_SEEN)
    .map(({ fromItemId, toItemId, calls }) => ({ fromItemId, toItemId, calls }));
};

/** What carried traffic in the last 24 h but is missing from the map. */
export function seenEntries(
  summary: TrafficSummary,
  index: TrafficIndex,
  connectors: Connector[]
): SeenEntries {
  return {
    unplaced: unplacedOf(summary, index),
    unconnected: unconnectedOf(summary, index, connectors)
  };
}

/** The unplaced identities, for the identity editor's suggestions. */
export function suggestIdentities(
  summary: TrafficSummary,
  index: TrafficIndex
): string[] {
  return unplacedOf(summary, index).map((entry) => entry.identity);
}
