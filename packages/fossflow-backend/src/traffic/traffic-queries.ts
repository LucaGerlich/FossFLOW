import { Inject, Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { emptyHistogram, percentileMs } from './histogram.js';
import type {
  TrafficAlias,
  TrafficEdgeDetail,
  TrafficPair,
  TrafficRange,
  TrafficStats,
  TrafficSummary
} from './wire.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const SUMMARY_MINUTES = 5;
const SEEN_MS = 24 * HOUR_MS;
const MAX_EDGES = 2000;
const MAX_OPERATIONS = 10;
const MAX_FAILURES = 20;

const floorTo = (ms: number, unit: number): number => Math.floor(ms / unit) * unit;
const toMs = (value: Date | string): number => new Date(value).getTime();

interface Counts {
  calls: number;
  failures: number;
  histogram: number[];
}

const emptyCounts = (): Counts => ({ calls: 0, failures: 0, histogram: emptyHistogram() });

const addCounts = (into: Counts, from: Counts): Counts => ({
  calls: into.calls + from.calls,
  failures: into.failures + from.failures,
  histogram: into.histogram.map((count, index) => count + (from.histogram[index] ?? 0))
});

const statsOf = (counts: Counts, minutes: number): TrafficStats => ({
  calls: counts.calls,
  failures: counts.failures,
  callsPerMin: counts.calls / minutes,
  failedPct: counts.calls === 0 ? 0 : (100 * counts.failures) / counts.calls,
  p50Ms: percentileMs(counts.histogram, 0.5),
  p95Ms: percentileMs(counts.histogram, 0.95)
});

const rangeSpec = (range: TrafficRange): { stepMs: number; points: number; minutes: number } => {
  if (range === '1h') return { stepMs: MINUTE_MS, points: 60, minutes: 60 };
  if (range === '24h') return { stepMs: HOUR_MS, points: 24, minutes: 1440 };
  return { stepMs: HOUR_MS, points: 168, minutes: 10080 };
};

/** Read side of the traffic tables: the map's summary and an arrow's detail. */
@Injectable()
export class TrafficQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async summary(projectId: string, now: Date): Promise<TrafficSummary> {
    const nowMs = now.getTime();
    const start = floorTo(nowMs, MINUTE_MS) - (SUMMARY_MINUTES - 1) * MINUTE_MS;
    const windowMinutes = (nowMs - start) / MINUTE_MS;
    const cut = floorTo(nowMs, HOUR_MS) - HOUR_MS;
    const seenFrom = floorTo(nowMs, HOUR_MS) - SEEN_MS;

    const [windowRows, seenRows, aliasRows] = await Promise.all([
      this.db.execute<{
        kind: 'call' | 'incoming';
        caller: string;
        callee: string;
        calls: number;
        failures: number;
        histogram: number[];
      }>(sql`
        select kind, caller, callee, sum(calls)::int as calls, sum(failures)::int as failures,
          int_array_sum(histogram) as histogram
        from traffic_minute
        where project_id = ${projectId} and minute >= ${new Date(start)}::timestamptz
        group by kind, caller, callee
      `),
      this.db.execute<{ caller: string; callee: string; last_seen: Date | string }>(sql`
        select caller, callee, max(seen) as last_seen from (
          select caller, callee, max(hour) as seen from traffic_hour
          where project_id = ${projectId} and kind = 'call'
            and hour >= ${new Date(seenFrom)}::timestamptz and hour < ${new Date(cut)}::timestamptz
          group by caller, callee
          union all
          select caller, callee, max(minute) as seen from traffic_minute
          where project_id = ${projectId} and kind = 'call' and minute >= ${new Date(cut)}::timestamptz
          group by caller, callee
        ) seen
        group by caller, callee
      `),
      this.db.execute<{ host: string; service: string }>(sql`
        select host, min(service) as service from traffic_alias
        where project_id = ${projectId} and last_seen_at >= ${new Date(nowMs - SEEN_MS)}::timestamptz
        group by host
        having count(distinct service) = 1
      `)
    ]);

    const pairCounts = new Map<string, Counts>();
    const calleeCounts = new Map<string, Counts>();
    const serviceCounts = new Map<string, Counts>();
    const bump = (map: Map<string, Counts>, key: string, row: Counts): void => {
      map.set(key, addCounts(map.get(key) ?? emptyCounts(), row));
    };
    for (const row of windowRows.rows) {
      if (row.calls <= 0) continue;
      if (row.kind === 'call') {
        bump(pairCounts, JSON.stringify([row.caller, row.callee]), row);
        bump(calleeCounts, row.callee, row);
      } else {
        bump(serviceCounts, row.callee, row);
      }
    }

    const edges = seenRows.rows
      .map((row) => {
        const counts = pairCounts.get(JSON.stringify([row.caller, row.callee])) ?? emptyCounts();
        return {
          caller: row.caller,
          callee: row.callee,
          ...statsOf(counts, windowMinutes),
          lastSeenAt: new Date(row.last_seen).toISOString()
        };
      })
      .sort((a, b) => b.calls - a.calls || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, MAX_EDGES);

    const aliases: TrafficAlias[] = aliasRows.rows.map((row) => ({
      host: `host:${row.host}`,
      service: `service:${row.service}`
    }));

    return {
      generatedAt: now.toISOString(),
      windowMinutes,
      edges,
      callees: [...calleeCounts].map(([callee, counts]) => ({ callee, ...statsOf(counts, windowMinutes) })),
      services: [...serviceCounts].map(([service, counts]) => ({
        service,
        ...statsOf(counts, windowMinutes)
      })),
      aliases
    };
  }

  async edge(
    projectId: string,
    pairs: TrafficPair[],
    range: TrafficRange,
    now: Date
  ): Promise<TrafficEdgeDetail> {
    const nowMs = now.getTime();
    const { stepMs, points, minutes } = rangeSpec(range);
    const first = (range === '1h' ? floorTo(nowMs, MINUTE_MS) : floorTo(nowMs, HOUR_MS)) - (points - 1) * stepMs;
    const cut = floorTo(nowMs, HOUR_MS) - HOUR_MS;
    const source = this.edgeRows(projectId, pairs, range, first, cut);

    const [bucketRows, operationRows, failureRows] = await Promise.all([
      this.db.execute<{ at: Date | string; calls: number; failures: number; histogram: number[] }>(sql`
        select at, sum(calls)::int as calls, sum(failures)::int as failures,
          int_array_sum(histogram) as histogram
        from (${source}) rows group by at
      `),
      this.db.execute<{
        operation: string;
        calls: number;
        failures: number;
        histogram: number[];
      }>(sql`
        select operation, sum(calls)::int as calls, sum(failures)::int as failures,
          int_array_sum(histogram) as histogram
        from (${source}) rows
        group by operation order by sum(calls) desc, operation limit ${MAX_OPERATIONS}
      `),
      this.db.execute<{
        at: Date | string;
        caller: string;
        callee: string;
        operation: string;
        status: string;
        duration_ms: number;
      }>(sql`
        select at, caller, callee, operation, status, duration_ms from traffic_failure
        where project_id = ${projectId} and ${pairFilter(pairs)} and at >= ${new Date(first)}::timestamptz
        order by at desc, id desc limit ${MAX_FAILURES}
      `)
    ]);

    const byAt = new Map(bucketRows.rows.map((row) => [toMs(row.at), row]));
    let total = emptyCounts();
    const series = Array.from({ length: points }, (_, index) => {
      const at = first + index * stepMs;
      const row = byAt.get(at);
      const counts = row ?? emptyCounts();
      total = addCounts(total, counts);
      return {
        at: new Date(at).toISOString(),
        calls: counts.calls,
        failures: counts.failures,
        p95Ms: percentileMs(counts.histogram, 0.95)
      };
    });

    return {
      range,
      stepSeconds: range === '1h' ? 60 : 3600,
      totals: statsOf(total, minutes),
      series,
      operations: operationRows.rows.map((row) => ({
        operation: row.operation,
        calls: row.calls,
        failures: row.failures,
        p50Ms: percentileMs(row.histogram, 0.5),
        p95Ms: percentileMs(row.histogram, 0.95)
      })),
      failures: failureRows.rows.map((row) => ({
        at: new Date(row.at).toISOString(),
        caller: row.caller,
        callee: row.callee,
        operation: row.operation,
        status: row.status,
        durationMs: row.duration_ms
      }))
    };
  }

  /**
   * Rows of the pairs over the range as `(at, operation, calls, failures,
   * histogram)`. Hours before `cut` come from the roll-up and later ones from
   * the minutes, so no call is counted twice.
   */
  private edgeRows(projectId: string, pairs: TrafficPair[], range: TrafficRange, first: number, cut: number): SQL {
    const filter = pairFilter(pairs);
    if (range === '1h') {
      return sql`
        select minute as at, operation, calls, failures, histogram from traffic_minute
        where project_id = ${projectId} and ${filter} and minute >= ${new Date(first)}::timestamptz
      `;
    }
    return sql`
      select date_trunc('hour', minute, 'UTC') as at, operation, calls, failures, histogram
      from traffic_minute
      where project_id = ${projectId} and ${filter} and minute >= ${new Date(cut)}::timestamptz
      union all
      select hour as at, operation, calls, failures, histogram from traffic_hour
      where project_id = ${projectId} and ${filter}
        and hour >= ${new Date(first)}::timestamptz and hour < ${new Date(cut)}::timestamptz
    `;
  }
}

const pairFilter = (pairs: TrafficPair[]): SQL =>
  sql`(caller, callee) in (${sql.join(
    pairs.map((pair) => sql`(${pair.caller}, ${pair.callee})`),
    sql`, `
  )})`;
