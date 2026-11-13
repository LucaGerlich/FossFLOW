import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import type { AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import { project, trafficFailure, trafficHour, trafficMinute } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { emptyHistogram } from './histogram.js';
import { TrafficMaintenance } from './maintenance.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const PROJECT = 'maintenance-project';
// 2026-11-13 10:20 UTC
const NOW = new Date(Date.UTC(2026, 10, 13, 10, 20));
const THIS_HOUR = Math.floor(NOW.getTime() / HOUR) * HOUR;

const histogram = (counts: Record<number, number>): number[] => {
  const result = emptyHistogram();
  for (const [index, count] of Object.entries(counts)) result[Number(index)] = count;
  return result;
};

describe('traffic maintenance', () => {
  let t: TestApp;
  let db: Database;
  let maintenance: TrafficMaintenance;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    maintenance = t.app.get(TrafficMaintenance);
    await db.insert(project).values({ id: PROJECT, name: 'P', type: 'team' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await db.delete(trafficMinute);
    await db.delete(trafficHour);
    await db.delete(trafficFailure);
  });

  const minute = (at: number, calls: number, hist: number[], operation = 'GET /') => ({
    projectId: PROJECT,
    kind: 'call' as const,
    caller: 'web',
    callee: 'api',
    operation,
    minute: new Date(at),
    calls,
    failures: 1,
    durationSumMs: calls * 10,
    histogram: hist
  });

  const hours = () => db.select().from(trafficHour).orderBy(asc(trafficHour.hour));

  it('rolls minutes into hours', async () => {
    const prev = THIS_HOUR - HOUR;
    await db.insert(trafficMinute).values([
      minute(prev + 5 * MINUTE, 1, histogram({ 0: 1 })),
      minute(prev + 6 * MINUTE, 2, histogram({ 1: 2 }))
    ]);
    await maintenance.rollUp(NOW);
    const rows = await hours();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.hour.getTime(), prev);
    assert.equal(rows[0]?.calls, 3);
    assert.equal(rows[0]?.failures, 2);
    assert.equal(rows[0]?.durationSumMs, 30);
    assert.deepEqual(rows[0]?.histogram, histogram({ 0: 1, 1: 2 }));
  });

  it('leaves the current hour alone', async () => {
    await db.insert(trafficMinute).values(minute(THIS_HOUR + MINUTE, 1, histogram({ 0: 1 })));
    await maintenance.rollUp(NOW);
    assert.equal((await hours()).length, 0);
  });

  it('rerunning changes nothing', async () => {
    const prev = THIS_HOUR - HOUR;
    await db.insert(trafficMinute).values([
      minute(prev + MINUTE, 1, histogram({ 0: 1 })),
      minute(prev + 2 * MINUTE, 2, histogram({ 1: 2 }))
    ]);
    await maintenance.rollUp(NOW);
    const first = await hours();
    await maintenance.rollUp(NOW);
    await maintenance.rollUp(NOW);
    assert.deepEqual(await hours(), first);
  });

  it('completes a partly rolled hour', async () => {
    const prev = THIS_HOUR - HOUR;
    await db.insert(trafficMinute).values(minute(prev + MINUTE, 1, histogram({ 0: 1 })));
    await maintenance.rollUp(NOW);
    await db.insert(trafficMinute).values(minute(prev + 30 * MINUTE, 4, histogram({ 2: 4 })));
    await maintenance.rollUp(NOW);
    const rows = await hours();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.calls, 5);
    assert.deepEqual(rows[0]?.histogram, histogram({ 0: 1, 2: 4 }));
  });

  it('catches up after downtime', async () => {
    const latest = THIS_HOUR - 5 * HOUR;
    await db.insert(trafficHour).values({ ...minute(latest, 1, histogram({ 0: 1 })), hour: new Date(latest) });
    const minutes = [1, 2, 3, 4, 5].map((back) => minute(THIS_HOUR - back * HOUR + 10 * MINUTE, 1, histogram({ 0: 1 })));
    await db.insert(trafficMinute).values(minutes);
    await maintenance.rollUp(NOW);
    const rows = await hours();
    assert.deepEqual(
      rows.map((row) => row.hour.getTime()),
      [1, 2, 3, 4, 5].map((back) => THIS_HOUR - back * HOUR).reverse()
    );
    assert.ok(rows.every((row) => row.calls === 1));
  });

  it('rolls up on exact UTC hours when the database session is in a half-hour zone', async () => {
    const pool = new pg.Pool({ connectionString: t.config.databaseUrl, options: '-c TimeZone=Asia/Kolkata' });
    try {
      const kolkata = drizzle(pool, { schema });
      const prev = THIS_HOUR - HOUR;
      await db.insert(trafficMinute).values([
        minute(prev + 10 * MINUTE, 1, histogram({ 0: 1 })),
        minute(prev + 45 * MINUTE, 1, histogram({ 0: 1 }))
      ]);
      await new TrafficMaintenance(kolkata, t.config).rollUp(NOW);
      const rows = await hours();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.hour.getTime(), prev);
      assert.equal(rows[0]?.calls, 2);
    } finally {
      await pool.end();
    }
  });

  it('prunes by age and count', async () => {
    const at = NOW.getTime();
    await db.insert(trafficMinute).values([
      minute(at - 8 * DAY, 1, histogram({ 0: 1 }), 'old'),
      minute(at - 6 * DAY, 1, histogram({ 0: 1 }), 'recent')
    ]);
    await db.insert(trafficHour).values([
      { ...minute(0, 1, histogram({ 0: 1 }), 'old'), hour: new Date(at - 91 * DAY) },
      { ...minute(0, 1, histogram({ 0: 1 }), 'recent'), hour: new Date(at - 89 * DAY) }
    ]);
    const failure = (when: number, operation: string) => ({
      projectId: PROJECT,
      kind: 'call' as const,
      caller: 'web',
      callee: 'api',
      operation,
      at: new Date(when),
      durationMs: 5,
      status: '500'
    });
    await db.insert(trafficFailure).values([
      failure(at - 8 * DAY, 'old'),
      ...Array.from({ length: 501 }, (_, i) => failure(at - 3 * HOUR + i * MINUTE, i === 0 ? 'oldest' : `f${i}`)),
      { ...failure(at - 3 * HOUR, 'other-arrow'), callee: 'db' }
    ]);

    await maintenance.prune(NOW);

    assert.deepEqual((await db.select().from(trafficMinute)).map((row) => row.operation), ['recent']);
    assert.deepEqual((await db.select().from(trafficHour)).map((row) => row.operation), ['recent']);
    const failures = await db.select().from(trafficFailure);
    assert.equal(failures.length, 501);
    assert.ok(!failures.some((row) => row.operation === 'old' || row.operation === 'oldest'));
    assert.ok(failures.some((row) => row.callee === 'db'));
    assert.equal(failures.filter((row) => row.callee === 'api').length, 500);
  });

  it('honours the env settings', async () => {
    const config: AppConfig = { ...t.config, traffic: { ...t.config.traffic, minutesDays: 3 } };
    const strict = new TrafficMaintenance(db, config);
    await db.insert(trafficMinute).values([
      minute(NOW.getTime() - 4 * DAY, 1, histogram({ 0: 1 }), 'old'),
      minute(NOW.getTime() - 2 * DAY, 1, histogram({ 0: 1 }), 'recent')
    ]);
    await strict.prune(NOW);
    assert.deepEqual(
      (await db.select().from(trafficMinute).where(eq(trafficMinute.projectId, PROJECT))).map((row) => row.operation),
      ['recent']
    );
  });
});
