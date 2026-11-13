import type { Connector } from 'src/types';
import { boxOf, createRouter, type TrafficIndex } from './match';
import type { TrafficState } from './TrafficContext';
import type { TrafficPair, TrafficStats, TrafficSummary } from './types';

export interface ArrowTraffic {
  connectorId: string;
  pairs: TrafficPair[];
  callers: string[];
  calls: number;
  failures: number;
  callsPerMin: number;
  failedPct: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

const MIN_FAILURES = 5;
const MIN_FAILED_PCT = 5;

/** Failing means at least 5 failures and at least 5 % of calls failing. */
export const isFailing = (stats: { calls: number; failures: number }): boolean =>
  stats.failures >= MIN_FAILURES &&
  (100 * stats.failures) / stats.calls >= MIN_FAILED_PCT;

type SummaryEdge = TrafficSummary['edges'][number];

/** Every summary edge routed to a connector, in both directions, summed. */
export const arrowTraffic = (
  summary: TrafficSummary,
  index: TrafficIndex,
  connectors: Connector[]
): Map<string, ArrowTraffic> => {
  const route = createRouter(index, connectors);
  const grouped = new Map<string, SummaryEdge[]>();
  for (const edge of summary.edges) {
    const match = route(edge.caller, edge.callee);
    if (!match) continue;
    grouped.set(match.connectorId, [
      ...(grouped.get(match.connectorId) ?? []),
      edge
    ]);
  }

  const arrows = new Map<string, ArrowTraffic>();
  for (const [connectorId, edges] of grouped) {
    const calls = edges.reduce((sum, edge) => sum + edge.calls, 0);
    const failures = edges.reduce((sum, edge) => sum + edge.failures, 0);
    const busiest = edges.reduce((best, edge) =>
      edge.calls > best.calls ? edge : best
    );
    const p95s = edges.flatMap((edge) => (edge.p95Ms === null ? [] : [edge.p95Ms]));
    arrows.set(connectorId, {
      connectorId,
      pairs: edges.map(({ caller, callee }) => ({ caller, callee })),
      callers: [...new Set(edges.map((edge) => edge.caller))],
      calls,
      failures,
      callsPerMin: edges.reduce((sum, edge) => sum + edge.callsPerMin, 0),
      failedPct: calls === 0 ? 0 : (100 * failures) / calls,
      p50Ms: busiest.p50Ms,
      p95Ms: p95s.length ? Math.max(...p95s) : null
    });
  }
  return arrows;
};

export interface BoxTrouble {
  failedPct: number;
  callerName: string | null;
}

const pctOf = (stats: Pick<TrafficStats, 'calls' | 'failures'>): number =>
  (100 * stats.failures) / stats.calls;

/**
 * The worst failing arrow into a box (named by its caller box), else the box's
 * own failing `services` entry. Null when the box is healthy.
 */
export const boxTrouble = (
  itemId: string,
  state: TrafficState,
  names: Map<string, string>
): BoxTrouble | null => {
  const summary = state.feed.summary;
  if (!summary) return null;

  const arrowed = new Set(
    [...state.arrows.values()].flatMap((arrow) =>
      arrow.pairs.map((pair) => `${pair.caller}\n${pair.callee}`)
    )
  );
  // Incoming calls by caller box; an arrow carries both directions, so only
  // the edges that end in this box count.
  const byCaller = new Map<string, { calls: number; failures: number }>();
  for (const edge of summary.edges) {
    if (boxOf(state.index, edge.callee) !== itemId) continue;
    const caller = boxOf(state.index, edge.caller);
    if (caller === null || caller === itemId) continue;
    if (!arrowed.has(`${edge.caller}\n${edge.callee}`)) continue;
    const sum = byCaller.get(caller) ?? { calls: 0, failures: 0 };
    byCaller.set(caller, {
      calls: sum.calls + edge.calls,
      failures: sum.failures + edge.failures
    });
  }

  let worst: BoxTrouble | null = null;
  for (const [caller, sum] of byCaller) {
    if (!isFailing(sum)) continue;
    const failedPct = pctOf(sum);
    if (!worst || failedPct > worst.failedPct) {
      worst = { failedPct, callerName: names.get(caller) ?? null };
    }
  }
  if (worst) return worst;

  for (const service of summary.services) {
    if (boxOf(state.index, service.service) !== itemId) continue;
    if (!isFailing(service)) continue;
    const failedPct = pctOf(service);
    if (!worst || failedPct > worst.failedPct) {
      worst = { failedPct, callerName: null };
    }
  }
  return worst;
};
