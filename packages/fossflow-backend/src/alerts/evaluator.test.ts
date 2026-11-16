import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { alertEvent, alertRule, ingestGap, meta, project, trafficMinute } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { emptyHistogram } from '../traffic/histogram.js';
import { POST_JSON } from '../connectors/outbound.js';
import { DELIVERY_SLEEP } from './deliveries.js';
import { DELIVERIES, type Deliveries } from './deliveries.token.js';
import { AlertEvaluator } from './evaluator.js';
import { IngestHeartbeat } from './heartbeat.js';

const PROJECT = 'evaluator-project';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date(Date.UTC(2026, 10, 13, 10, 0));
const after = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

describe('alert evaluator against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let evaluator: AlertEvaluator;
  let heartbeat: IngestHeartbeat;
  let real: TestApp;
  let stubPosts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const sent: Array<[string, string]> = [];
  const deliveries: Deliveries = {
    notify: async (eventId, state) => {
      sent.push([eventId, state]);
    }
  };

  beforeAll(async () => {
    t = await startTestApp({}, [{ provide: DELIVERIES, useValue: deliveries }]);
    real = await startTestApp({}, [
      {
        provide: POST_JSON,
        useValue: async (url: URL, body: unknown) => {
          stubPosts.push({ url: url.toString(), body: body as Record<string, unknown> });
          return { ok: true, status: 200, retryAfterSeconds: null, error: null };
        }
      },
      { provide: DELIVERY_SLEEP, useValue: async () => undefined }
    ]);
    db = t.app.get<Database>(DB);
    evaluator = t.app.get(AlertEvaluator);
    heartbeat = t.app.get(IngestHeartbeat);
    await db.insert(project).values({ id: PROJECT, name: 'P', type: 'team' });
  });
  afterAll(async () => {
    await t.close();
    await real.close();
  });
  beforeEach(async () => {
    sent.length = 0;
    await db.delete(alertRule);
    await db.delete(trafficMinute);
    await db.delete(ingestGap);
    await db.delete(meta);
  });

  const traffic = (when: Date, calls: number, failures: number): typeof trafficMinute.$inferInsert => ({
    projectId: PROJECT,
    kind: 'call',
    caller: 'service:web',
    callee: 'host:api.magicline.com',
    operation: 'GET /',
    minute: when,
    calls,
    failures,
    durationSumMs: calls,
    histogram: emptyHistogram()
  });

  const failingRule = async (id = 'rule-1'): Promise<string> => {
    await db.insert(alertRule).values({
      id,
      projectId: PROJECT,
      name: 'Web to Magicline',
      kind: 'failing',
      target: { type: 'arrow', from: 'service:web', to: 'host:api.magicline.com' },
      threshold: 5,
      windowMinutes: 1,
      minCalls: 10
    });
    return id;
  };

  const events = () => db.select().from(alertEvent);

  it('starts once, reminds after 4 hours, and resolves after 3 clear minutes', async () => {
    const id = await failingRule();
    const unhealthy = [T0, after(T0, MINUTE), after(T0, 4 * HOUR)];
    const healthy = [5, 6, 7, 8].map((minute) => after(T0, 4 * HOUR + minute * MINUTE));
    await db.insert(trafficMinute).values([
      ...unhealthy.map((when) => traffic(when, 100, 10)),
      ...healthy.map((when) => traffic(when, 100, 0))
    ]);

    assert.deepEqual(await evaluator.tick(T0), { started: [id], reminded: [], resolved: [] });
    assert.deepEqual(await evaluator.tick(after(T0, MINUTE)), { started: [], reminded: [], resolved: [] });
    assert.deepEqual(await evaluator.tick(after(T0, 4 * HOUR)), { started: [], reminded: [id], resolved: [] });

    const clearAt = healthy[0]!;
    assert.deepEqual(await evaluator.tick(clearAt), { started: [], reminded: [], resolved: [] });
    assert.deepEqual(await evaluator.tick(after(clearAt, MINUTE)), { started: [], reminded: [], resolved: [] });
    assert.deepEqual(await evaluator.tick(after(clearAt, 2 * MINUTE)), { started: [], reminded: [], resolved: [] });
    assert.equal((await events())[0]?.resolvedAt, null);
    assert.deepEqual(await evaluator.tick(after(clearAt, 3 * MINUTE)), { started: [], reminded: [], resolved: [id] });

    const [event] = await events();
    assert.equal(event?.resolvedAt?.getTime(), after(clearAt, 3 * MINUTE).getTime());
    assert.deepEqual(
      sent.map(([, state]) => state),
      ['firing', 'reminder', 'resolved']
    );
    assert.equal(new Set(sent.map(([eventId]) => eventId)).size, 1);
    assert.equal(sent[0]?.[0], String(event?.id));
  });

  it('sends one start for a flapping rule and never resolves it', async () => {
    const id = await failingRule();
    const minutes = Array.from({ length: 10 }, (_, index) => after(T0, index * MINUTE));
    await db.insert(trafficMinute).values(minutes.map((when, index) => traffic(when, 1000, index % 2 === 0 ? 51 : 49)));

    const started: string[] = [];
    const resolved: string[] = [];
    for (const when of minutes) {
      const result = await evaluator.tick(when);
      started.push(...result.started);
      resolved.push(...result.resolved);
    }
    assert.deepEqual(started, [id]);
    assert.deepEqual(resolved, []);
    assert.equal((await events()).length, 1);
  });

  it('copes with a rule deleted between ticks', async () => {
    await failingRule();
    await db.insert(trafficMinute).values([traffic(T0, 100, 50), traffic(after(T0, MINUTE), 100, 50)]);
    assert.equal((await evaluator.tick(T0)).started.length, 1);
    await db.delete(alertRule).where(eq(alertRule.id, 'rule-1'));
    assert.deepEqual(await evaluator.tick(after(T0, MINUTE)), { started: [], reminded: [], resolved: [] });
  });

  it('records the heartbeat on every tick', async () => {
    await evaluator.tick(T0);
    const [row] = await db.select().from(meta).where(eq(meta.key, 'ingest.alive'));
    assert.deepEqual(row?.value, { at: T0.toISOString() });
  });

  it('writes a gap on restart only when the heartbeat is older than 5 minutes', async () => {
    const alive = (at: Date) => db.insert(meta).values({ key: 'ingest.alive', value: { at: at.toISOString() } });
    const now = after(T0, HOUR);

    await alive(after(now, -2 * MINUTE));
    await heartbeat.recordStart(now);
    assert.equal((await db.select().from(ingestGap)).length, 0);

    await db.delete(meta);
    const stale = after(now, -20 * MINUTE);
    await alive(stale);
    await heartbeat.recordStart(now);
    const gaps = await db.select().from(ingestGap);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.from.getTime(), stale.getTime());
    assert.equal(gaps[0]?.to.getTime(), now.getTime());
  });

  it('keeps the gap when recording the start fails at boot, and records it on the next tick', async () => {
    const stale = new Date(Date.now() - HOUR);
    await db.insert(meta).values({ key: 'ingest.alive', value: { at: stale.toISOString() } });
    let failures = 1;
    const flaky = {
      recordStart: async (now: Date) => {
        if (failures-- > 0) throw new Error('database unavailable');
        await heartbeat.recordStart(now);
      },
      beat: (now: Date) => heartbeat.beat(now)
    } as unknown as IngestHeartbeat;
    const booting = new AlertEvaluator(db, flaky, deliveries);

    const bootFrom = Date.now();
    await booting.onApplicationBootstrap();
    const bootTo = Date.now();
    booting.beforeApplicationShutdown();

    const [row] = await db.select().from(meta).where(eq(meta.key, 'ingest.alive'));
    assert.deepEqual(row?.value, { at: stale.toISOString() });
    assert.equal((await db.select().from(ingestGap)).length, 0);

    const later = new Date(bootTo + 2 * MINUTE);
    await booting.tick(later);
    const gaps = await db.select().from(ingestGap);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]?.from.getTime(), stale.getTime());
    assert.ok(gaps[0] && gaps[0].to.getTime() >= bootFrom && gaps[0].to.getTime() <= bootTo);
    const [beat] = await db.select().from(meta).where(eq(meta.key, 'ingest.alive'));
    assert.deepEqual(beat?.value, { at: later.toISOString() });

    await booting.tick(after(later, MINUTE));
    assert.equal((await db.select().from(ingestGap)).length, 1);
  });

  it('delivers a firing alert to a webhook, end to end', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const owner = real.browser();
    await owner.post('/api/setup/owner', { name: 'Olivia', email: 'owner@example.com', password: 'Owner-pass-1' });
    const projectId = (await owner.post('/api/projects', { name: 'Infrastructure' })).body.id;
    const channel = (
      await owner.post(`/api/projects/${projectId}/credentials`, {
        name: 'Pager',
        type: 'webhook',
        settings: { url: 'https://hooks.example.com/pager' }
      })
    ).body.id;
    posts.length = 0;
    const realDb = real.app.get<Database>(DB);
    await realDb.insert(alertRule).values({
      id: 'rule-e2e',
      projectId,
      name: 'Web to Magicline',
      kind: 'failing',
      target: { type: 'arrow', from: 'service:web', to: 'host:api.magicline.com' },
      threshold: 5,
      windowMinutes: 1,
      minCalls: 10,
      channelIds: [channel]
    });
    await realDb.insert(trafficMinute).values({ ...traffic(T0, 100, 50), projectId });

    const pending: Array<Promise<void>> = [];
    const original = real.app.get<Deliveries>(DELIVERIES).notify.bind(real.app.get<Deliveries>(DELIVERIES));
    real.app.get<Deliveries>(DELIVERIES).notify = (eventId, state) => {
      const promise = original(eventId, state);
      pending.push(promise);
      return promise;
    };
    stubPosts = posts;
    await real.app.get(AlertEvaluator).tick(T0);
    await Promise.all(pending);

    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.body.state, 'firing');
    assert.equal((posts[0]?.body.rule as { name: string }).name, 'Web to Magicline');
  });
});
