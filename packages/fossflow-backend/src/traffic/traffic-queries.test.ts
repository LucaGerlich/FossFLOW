import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { project, trafficAlias, trafficFailure, trafficHour, trafficMinute } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { emptyHistogram, percentileMs } from './histogram.js';
import { TrafficQueries } from './traffic-queries.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const PROJECT = 'queries-project';
const OTHER = 'queries-other';
// 2026-11-13 12:02:30 UTC
const NOW = new Date(Date.UTC(2026, 10, 13, 12, 2, 30));
const at = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 10, 13, hour, minute));

const histogram = (counts: Record<number, number>): number[] => {
  const result = emptyHistogram();
  for (const [index, count] of Object.entries(counts)) result[Number(index)] = count;
  return result;
};

describe('traffic queries', () => {
  let t: TestApp;
  let db: Database;
  let queries: TrafficQueries;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    queries = t.app.get(TrafficQueries);
    await db.insert(project).values([
      { id: PROJECT, name: 'P', type: 'team' },
      { id: OTHER, name: 'O', type: 'team' }
    ]);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await db.delete(trafficMinute);
    await db.delete(trafficHour);
    await db.delete(trafficFailure);
    await db.delete(trafficAlias);
  });

  const minuteRow = (
    when: Date,
    over: Partial<typeof trafficMinute.$inferInsert> = {}
  ): typeof trafficMinute.$inferInsert => ({
    projectId: PROJECT,
    kind: 'call',
    caller: 'service:a',
    callee: 'host:b.internal',
    operation: 'GET /',
    minute: when,
    calls: 10,
    failures: 0,
    durationSumMs: 100,
    histogram: histogram({ 2: 10 }),
    ...over
  });
  const hourRow = (
    when: Date,
    over: Partial<typeof trafficHour.$inferInsert> = {}
  ): typeof trafficHour.$inferInsert => {
    const { minute: _minute, ...rest } = minuteRow(when, over as never);
    return { ...rest, hour: when, ...over } as typeof trafficHour.$inferInsert;
  };

  describe('summary', () => {
    it('computes stats over the window', async () => {
      const hist = [histogram({ 3: 40 }), histogram({ 5: 20 }), histogram({ 8: 10 })];
      await db.insert(trafficMinute).values([
        minuteRow(at(11, 58), { calls: 60, failures: 3, histogram: hist[0] }),
        minuteRow(at(11, 59), { calls: 60, failures: 3, histogram: hist[1] }),
        minuteRow(at(12, 0), { calls: 60, failures: 3, histogram: hist[2] }),
        minuteRow(at(12, 1), { calls: 60, failures: 3, histogram: hist[0] }),
        minuteRow(at(12, 2), { calls: 60, failures: 3, histogram: hist[1] }),
        // before the window
        minuteRow(at(11, 57), { calls: 999, failures: 999 })
      ]);
      const summary = await queries.summary(PROJECT, NOW);
      const summed = emptyHistogram().map(
        (_, i) => (hist[0]?.[i] ?? 0) * 2 + (hist[1]?.[i] ?? 0) * 2 + (hist[2]?.[i] ?? 0)
      );
      assert.equal(summary.windowMinutes, 4.5);
      assert.equal(summary.generatedAt, NOW.toISOString());
      const edge = summary.edges[0];
      assert.equal(summary.edges.length, 1);
      assert.equal(edge?.calls, 300);
      assert.equal(edge?.failures, 15);
      assert.equal(edge?.callsPerMin, 300 / 4.5);
      assert.equal(edge?.failedPct, 5);
      assert.equal(edge?.p50Ms, percentileMs(summed, 0.5));
      assert.equal(edge?.p95Ms, percentileMs(summed, 0.95));
      assert.equal(edge?.lastSeenAt, at(12, 2).toISOString());
    });

    it('lists quiet pairs with zeros', async () => {
      await db.insert(trafficHour).values(hourRow(at(9)));
      const summary = await queries.summary(PROJECT, NOW);
      assert.equal(summary.edges.length, 1);
      assert.equal(summary.edges[0]?.calls, 0);
      assert.equal(summary.edges[0]?.callsPerMin, 0);
      assert.equal(summary.edges[0]?.failedPct, 0);
      assert.equal(summary.edges[0]?.p50Ms, null);
      assert.equal(summary.edges[0]?.p95Ms, null);
      assert.equal(summary.edges[0]?.lastSeenAt, at(9).toISOString());
      assert.deepEqual(summary.callees, []);
    });

    it('orders by window calls, then recency, and ignores hours older than 24 h', async () => {
      await db.insert(trafficMinute).values([
        minuteRow(at(12, 1), { callee: 'host:busy', calls: 50 }),
        minuteRow(at(11, 30), { callee: 'host:recent-quiet' })
      ]);
      await db.insert(trafficHour).values([
        hourRow(at(8), { callee: 'host:old-quiet' }),
        hourRow(new Date(at(12).getTime() - 25 * HOUR), { callee: 'host:too-old' })
      ]);
      const summary = await queries.summary(PROJECT, NOW);
      assert.deepEqual(
        summary.edges.map((edge) => edge.callee),
        ['host:busy', 'host:recent-quiet', 'host:old-quiet']
      );
    });

    it('sums incoming per service and calls per callee', async () => {
      await db.insert(trafficMinute).values([
        minuteRow(at(12, 1), { kind: 'incoming', caller: '', callee: 'service:billing', calls: 20 }),
        minuteRow(at(12, 2), { kind: 'incoming', caller: '', callee: 'service:billing', calls: 10 }),
        minuteRow(at(12, 1), { caller: 'service:a', callee: 'host:db', calls: 7 }),
        minuteRow(at(12, 1), { caller: 'service:c', callee: 'host:db', calls: 5 })
      ]);
      const summary = await queries.summary(PROJECT, NOW);
      assert.equal(summary.services.length, 1);
      assert.equal(summary.services[0]?.service, 'service:billing');
      assert.equal(summary.services[0]?.calls, 30);
      assert.equal(summary.callees.length, 1);
      assert.equal(summary.callees[0]?.callee, 'host:db');
      assert.equal(summary.callees[0]?.calls, 12);
      assert.equal(summary.edges.length, 2);
    });

    it('returns hosts claimed by exactly one service', async () => {
      await db.insert(trafficAlias).values([
        { projectId: PROJECT, host: 'b.internal', service: 'B', lastSeenAt: at(11) },
        { projectId: PROJECT, host: 'shared.internal', service: 'X', lastSeenAt: at(11) },
        { projectId: PROJECT, host: 'shared.internal', service: 'Y', lastSeenAt: at(10) },
        { projectId: PROJECT, host: 'stale.internal', service: 'Z', lastSeenAt: new Date(NOW.getTime() - 30 * HOUR) }
      ]);
      const summary = await queries.summary(PROJECT, NOW);
      assert.deepEqual(summary.aliases, [{ host: 'host:b.internal', service: 'service:B' }]);
    });

    it('does not see other projects', async () => {
      await db.insert(trafficMinute).values([
        minuteRow(at(12, 1), { projectId: OTHER, calls: 500 }),
        minuteRow(at(12, 1), { projectId: OTHER, kind: 'incoming', caller: '', callee: 'service:x' })
      ]);
      await db.insert(trafficHour).values(hourRow(at(9), { projectId: OTHER }));
      await db
        .insert(trafficAlias)
        .values({ projectId: OTHER, host: 'o.internal', service: 'O', lastSeenAt: at(11) });
      const summary = await queries.summary(PROJECT, NOW);
      assert.deepEqual([summary.edges, summary.callees, summary.services, summary.aliases], [[], [], [], []]);
    });
  });

  describe('edge', () => {
    const pair = { caller: 'service:a', callee: 'host:b.internal' };

    it('gives 60 minute points for 1h', async () => {
      await db.insert(trafficMinute).values([
        minuteRow(at(12, 1), { failures: 2, histogram: histogram({ 4: 10 }) }),
        minuteRow(at(11, 3)),
        minuteRow(at(11, 2)),
        minuteRow(at(12, 1), { operation: 'POST /x', calls: 3 }),
        ...Array.from({ length: 11 }, (_, i) => minuteRow(at(12, 0), { operation: `op-${i}`, calls: 1 })),
        minuteRow(at(11, 2), { projectId: OTHER, calls: 777 })
      ]);
      const detail = await queries.edge(PROJECT, [pair], '1h', NOW);
      assert.equal(detail.range, '1h');
      assert.equal(detail.stepSeconds, 60);
      assert.equal(detail.series.length, 60);
      assert.equal(detail.series[0]?.at, at(11, 3).toISOString());
      assert.equal(detail.series[59]?.at, at(12, 2).toISOString());
      const point = detail.series.find((p) => p.at === at(12, 1).toISOString());
      assert.equal(point?.failures, 2);
      assert.equal(point?.calls, 13);
      assert.equal(detail.series[57]?.calls, 11);
      assert.equal(detail.series[59]?.calls, 0);
      assert.equal(detail.series[59]?.p95Ms, null);
      // 11:02 is before the first point, so it is left out
      assert.equal(detail.totals.calls, 34);
      assert.equal(detail.totals.callsPerMin, detail.totals.calls / 60);
      assert.equal(detail.operations.length, 10);
      assert.equal(detail.operations[0]?.operation, 'GET /');
      assert.equal(detail.operations[0]?.calls, 20);
      assert.equal(detail.operations[1]?.operation, 'POST /x');
      assert.ok(detail.operations[0]?.p50Ms !== null);
    });

    it('lists the newest 20 failures first, for the pairs only', async () => {
      await db.insert(trafficFailure).values([
        ...Array.from({ length: 25 }, (_, i) => ({
          projectId: PROJECT,
          kind: 'call' as const,
          ...pair,
          operation: 'GET /',
          at: new Date(at(12, 0).getTime() + i * 1000),
          durationMs: 12.5,
          status: '500'
        })),
        {
          projectId: PROJECT,
          kind: 'call' as const,
          caller: 'service:a',
          callee: 'host:other',
          operation: 'GET /',
          at: at(12, 1),
          durationMs: 1,
          status: '500'
        },
        {
          projectId: PROJECT,
          kind: 'call' as const,
          ...pair,
          operation: 'GET /',
          at: at(10, 0),
          durationMs: 1,
          status: '500'
        }
      ]);
      const detail = await queries.edge(PROJECT, [pair], '1h', NOW);
      assert.equal(detail.failures.length, 20);
      assert.equal(detail.failures[0]?.at, new Date(at(12, 0).getTime() + 24_000).toISOString());
      assert.equal(detail.failures[0]?.status, '500');
      assert.equal(detail.failures[0]?.durationMs, 12.5);
      assert.equal(detail.failures[19]?.at, new Date(at(12, 0).getTime() + 5000).toISOString());
    });

    it('counts each hour once for 24h and 7d', async () => {
      // 10:00 exists both rolled up and as minutes: only the hour row counts.
      await db.insert(trafficHour).values(hourRow(at(10), { calls: 600 }));
      await db.insert(trafficMinute).values([
        minuteRow(at(10, 5), { calls: 300 }),
        minuteRow(at(10, 6), { calls: 300 }),
        // the current hour (and the one before the cut) come from minutes
        minuteRow(at(11, 20), { calls: 40 }),
        minuteRow(at(12, 1), { calls: 4 })
      ]);
      const day = await queries.edge(PROJECT, [pair], '24h', NOW);
      assert.equal(day.stepSeconds, 3600);
      assert.equal(day.series.length, 24);
      assert.equal(day.series[0]?.at, new Date(at(12).getTime() - 23 * HOUR).toISOString());
      const byAt = new Map(day.series.map((p) => [p.at, p.calls]));
      assert.equal(byAt.get(at(10).toISOString()), 600);
      assert.equal(byAt.get(at(11).toISOString()), 40);
      assert.equal(byAt.get(at(12).toISOString()), 4);
      assert.equal(day.totals.calls, 644);
      assert.equal(day.totals.callsPerMin, 644 / 1440);
      const week = await queries.edge(PROJECT, [pair], '7d', NOW);
      assert.equal(week.series.length, 168);
      assert.equal(week.totals.calls, 644);
      assert.equal(week.totals.callsPerMin, 644 / 10080);
    });

    it('sums several pairs', async () => {
      const billing = { caller: 'service:billing api', callee: 'db:sql.example.net/members' };
      await db.insert(trafficMinute).values([
        minuteRow(at(12, 1), { calls: 3 }),
        minuteRow(at(12, 1), { ...billing, calls: 4 }),
        minuteRow(at(12, 1), { caller: 'service:billing api', callee: 'host:b.internal', calls: 100 })
      ]);
      const detail = await queries.edge(PROJECT, [pair, billing], '1h', NOW);
      assert.equal(detail.totals.calls, 7);
    });
  });
});
