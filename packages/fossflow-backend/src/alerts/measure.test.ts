import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { alertRule, ingestGap, project, trafficAlias, trafficHour, trafficMinute } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { emptyHistogram, percentileMs } from '../traffic/histogram.js';
import { measureProject, type RuleRow } from './measure.js';

const PROJECT = 'measure-project';
const at = (hour: number, minute: number, second = 0): Date => new Date(Date.UTC(2026, 10, 13, hour, minute, second));

const histogram = (counts: Record<number, number>): number[] => {
  const result = emptyHistogram();
  for (const [index, count] of Object.entries(counts)) result[Number(index)] = count;
  return result;
};

describe('measuring alert rules against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let counter = 0;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    await db.insert(project).values({ id: PROJECT, name: 'P', type: 'team' });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await db.delete(trafficMinute);
    await db.delete(trafficHour);
    await db.delete(trafficAlias);
    await db.delete(ingestGap);
    await db.delete(alertRule);
  });

  const minuteRow = (
    when: Date,
    calls: number,
    failures: number,
    extra: Partial<typeof trafficMinute.$inferInsert> = {}
  ): typeof trafficMinute.$inferInsert => ({
    projectId: PROJECT,
    kind: 'call',
    caller: 'service:web',
    callee: 'host:api.magicline.com',
    operation: 'GET /',
    minute: when,
    calls,
    failures,
    durationSumMs: calls * 10,
    histogram: histogram({ 1: calls }),
    ...extra
  });

  const makeRule = async (overrides: Partial<typeof alertRule.$inferInsert> = {}): Promise<RuleRow> => {
    counter += 1;
    const [row] = await db
      .insert(alertRule)
      .values({
        id: `rule-${counter}`,
        projectId: PROJECT,
        name: 'Rule',
        kind: 'failing',
        target: { type: 'arrow', from: 'service:web', to: 'host:*.magicline.com' },
        threshold: 2,
        windowMinutes: 5,
        minCalls: 10,
        ...overrides
      })
      .returning();
    assert.ok(row);
    return row;
  };

  it('measures failing over the window and respects minCalls', async () => {
    const failures = [11, 11, 10, 10, 10];
    await db.insert(trafficMinute).values([
      ...failures.map((count, index) => minuteRow(at(9, 40 + index), 252, count)),
      minuteRow(at(9, 39), 500, 500) // outside the 5 minute window
    ]);
    const now = at(9, 44, 30);

    const rule = await makeRule();
    const result = (await measureProject(db, PROJECT, [rule], now)).get(rule.id);
    assert.equal(result?.status, 'met');
    assert.equal(result?.calls, 1260);
    assert.ok(Math.abs((result?.value ?? 0) - 4.127) < 0.01);

    const strict = await makeRule({ minCalls: 2000 });
    assert.equal((await measureProject(db, PROJECT, [strict], now)).get(strict.id)?.status, 'unknown');

    const lenient = await makeRule({ threshold: 5 });
    assert.equal((await measureProject(db, PROJECT, [lenient], now)).get(lenient.id)?.status, 'clear');
  });

  it('measures slow with the merged histogram', async () => {
    await db
      .insert(trafficMinute)
      .values([
        minuteRow(at(9, 43), 100, 0, { histogram: histogram({ 2: 60, 8: 40 }) }),
        minuteRow(at(9, 44), 100, 0, { histogram: histogram({ 2: 20, 10: 80 }) })
      ]);
    const merged = histogram({ 2: 80, 8: 40, 10: 80 });
    const expected = percentileMs(merged, 0.95);
    assert.ok(expected !== null);

    const rule = await makeRule({ kind: 'slow', threshold: 100, windowMinutes: 2 });
    const result = (await measureProject(db, PROJECT, [rule], at(9, 44))).get(rule.id);
    assert.equal(result?.status, 'met');
    assert.equal(result?.value, expected);
    assert.equal(result?.calls, 200);
  });

  it('lets arrow rules follow unambiguous aliases only', async () => {
    const now = at(9, 44);
    await db.insert(trafficMinute).values(minuteRow(at(9, 44), 100, 50, { callee: 'host:orders.internal' }));
    await db.insert(trafficAlias).values({
      projectId: PROJECT,
      host: 'orders.internal',
      service: 'orders',
      lastSeenAt: at(9, 0)
    });
    const rule = await makeRule({ target: { type: 'arrow', from: 'service:web', to: 'service:orders' } });

    const followed = (await measureProject(db, PROJECT, [rule], now)).get(rule.id);
    assert.equal(followed?.status, 'met');
    assert.equal(followed?.calls, 100);

    await db.insert(trafficAlias).values({
      projectId: PROJECT,
      host: 'orders.internal',
      service: 'billing',
      lastSeenAt: at(9, 1)
    });
    const ambiguous = (await measureProject(db, PROJECT, [rule], now)).get(rule.id);
    assert.equal(ambiguous?.status, 'unknown');
  });

  it('measures boxes from incoming rows or from every caller into a host', async () => {
    await db.insert(trafficMinute).values([
      minuteRow(at(9, 44), 60, 30, { kind: 'incoming', caller: '', callee: 'service:billing' }),
      minuteRow(at(9, 44), 500, 0, { callee: 'host:billing.internal' }), // a call row: not an incoming one
      minuteRow(at(9, 44), 20, 10, { caller: 'service:web', callee: 'host:api.magicline.com' }),
      minuteRow(at(9, 44), 30, 15, { caller: 'service:jobs', callee: 'host:api.magicline.com' }),
      minuteRow(at(9, 44), 40, 0, { caller: 'service:web', callee: 'host:other.example.com' })
    ]);
    const now = at(9, 44);

    const service = await makeRule({ target: { type: 'box', identity: 'service:billing' }, threshold: 40 });
    const serviceResult = (await measureProject(db, PROJECT, [service], now)).get(service.id);
    assert.equal(serviceResult?.status, 'met');
    assert.equal(serviceResult?.calls, 60);
    assert.equal(serviceResult?.value, 50);

    const host = await makeRule({ target: { type: 'box', identity: 'host:*.magicline.com' }, threshold: 10 });
    const hostResult = (await measureProject(db, PROJECT, [host], now)).get(host.id);
    assert.equal(hostResult?.calls, 50);
    assert.equal(hostResult?.value, 50);
  });

  const silentRule = (overrides: Partial<typeof alertRule.$inferInsert> = {}) =>
    makeRule({
      kind: 'silent',
      threshold: null,
      windowMinutes: 30,
      target: { type: 'box', identity: 'host:api.magicline.com' },
      armedAt: at(8, 0),
      ...overrides
    });

  it('goes silent after at least N minutes', async () => {
    await db.insert(trafficMinute).values(minuteRow(at(9, 13), 5, 0));
    const rule = await silentRule();

    const early = (await measureProject(db, PROJECT, [rule], at(9, 43))).get(rule.id);
    assert.equal(early?.status, 'clear');
    assert.equal(early?.value, 29);

    const late = (await measureProject(db, PROJECT, [rule], at(9, 44))).get(rule.id);
    assert.equal(late?.status, 'met');
    assert.equal(late?.value, 30);
    assert.equal(late?.sinceMinutes, 30);
  });

  it('finds the last call in the hourly roll-up when the minutes are gone', async () => {
    await db.insert(trafficHour).values({
      projectId: PROJECT,
      kind: 'call',
      caller: 'service:web',
      callee: 'host:api.magicline.com',
      operation: 'GET /',
      hour: at(6, 0),
      calls: 10,
      failures: 0,
      durationSumMs: 100,
      histogram: histogram({ 1: 10 })
    });
    const rule = await silentRule();
    const result = (await measureProject(db, PROJECT, [rule], at(9, 44))).get(rule.id);
    assert.equal(result?.status, 'met');
    assert.equal(result?.value, 164); // silent since 07:00
  });

  it('lets a long gap delay silent alerts, and ignores a short one', async () => {
    await db.insert(trafficMinute).values(minuteRow(at(10, 0), 5, 0));
    await db.insert(ingestGap).values({ from: at(10, 10), to: at(10, 30) });
    const rule = await silentRule();

    assert.equal((await measureProject(db, PROJECT, [rule], at(10, 45))).get(rule.id)?.status, 'clear');
    const after = (await measureProject(db, PROJECT, [rule], at(11, 0))).get(rule.id);
    assert.equal(after?.status, 'met');
    assert.equal(after?.value, 30);

    await db.delete(ingestGap);
    await db.insert(ingestGap).values({ from: at(10, 10), to: at(10, 14) });
    assert.equal((await measureProject(db, PROJECT, [rule], at(10, 30))).get(rule.id)?.status, 'clear');
    assert.equal((await measureProject(db, PROJECT, [rule], at(10, 31))).get(rule.id)?.status, 'met');
  });

  it('keeps a rule that never carried traffic waiting, and arms it on the first call', async () => {
    const rule = await silentRule({ armedAt: null });
    const waiting = (await measureProject(db, PROJECT, [rule], at(9, 44))).get(rule.id);
    assert.equal(waiting?.status, 'unknown');
    const [before] = await db.select().from(alertRule).where(eq(alertRule.id, rule.id));
    assert.equal(before?.armedAt, null);

    await db.insert(trafficMinute).values(minuteRow(at(9, 40), 5, 0));
    const armed = (await measureProject(db, PROJECT, [rule], at(9, 44))).get(rule.id);
    assert.equal(armed?.status, 'clear');
    const [after] = await db.select().from(alertRule).where(eq(alertRule.id, rule.id));
    assert.equal(after?.armedAt?.getTime(), at(9, 44).getTime());
  });
});
