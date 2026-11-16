import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { POST_JSON, type PostResult } from '../connectors/outbound.js';
import { alertEvent, alertRule, credential, trafficMinute } from '../database/schema.js';
import { emptyHistogram } from '../traffic/histogram.js';
import { type Browser, startTestApp, TEST_ORIGIN, type TestApp } from '../test/app.js';
import { DELIVERY_SLEEP } from './deliveries.js';
import { DELIVERIES, type Deliveries } from './deliveries.token.js';
import type { DeliveryRecord } from './types.js';

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/secret-token';
const HOOK_URL = 'https://hooks.example.com/fossflow-secret';
const BODY_TEXT = 'response-body-must-never-be-stored';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

const reply = (status: number, retryAfterSeconds: number | null = null): PostResult => ({
  ok: status >= 200 && status < 300,
  status,
  retryAfterSeconds,
  error: null
});

describe('alert deliveries against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let deliveries: Deliveries;
  let owner: Browser;
  let team: string;
  let slackId: string;
  let hookId: string;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  /** What each URL answers, one entry per attempt; the last one repeats. */
  const answers = new Map<string, Array<PostResult | Error>>();

  const postJson = async (url: URL, body: unknown): Promise<PostResult> => {
    calls.push({ url: url.toString(), body: body as Record<string, unknown> });
    const queue = answers.get(url.toString()) ?? [reply(200)];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next ?? reply(200);
  };

  beforeAll(async () => {
    t = await startTestApp({}, [
      { provide: POST_JSON, useValue: postJson },
      { provide: DELIVERY_SLEEP, useValue: async (ms: number) => void sleeps.push(ms) }
    ]);
    db = t.app.get<Database>(DB);
    deliveries = t.app.get<Deliveries>(DELIVERIES);
    owner = t.browser();
    await owner.post('/api/setup/owner', { name: 'Olivia', email: 'owner@example.com', password: 'Owner-pass-1' });
    team = (await owner.post('/api/projects', { name: 'Infrastructure' })).body.id;
    slackId = (
      await owner.post(`/api/projects/${team}/credentials`, { name: 'Ops Slack', type: 'slack', settings: { url: SLACK_URL } })
    ).body.id;
    hookId = (
      await owner.post(`/api/projects/${team}/credentials`, { name: 'Pager', type: 'webhook', settings: { url: HOOK_URL } })
    ).body.id;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    calls.length = 0;
    sleeps.length = 0;
    answers.clear();
    await db.delete(alertRule);
  });

  const makeEvent = async (channelIds: string[], over: Partial<typeof alertRule.$inferInsert> = {}) => {
    await db.insert(alertRule).values({
      id: 'rule-1',
      projectId: team,
      name: 'Web to Magicline',
      kind: 'silent',
      target: { type: 'box', identity: 'service:web' },
      threshold: null,
      windowMinutes: 30,
      channelIds,
      ...over
    });
    const [event] = await db
      .insert(alertEvent)
      .values({ ruleId: 'rule-1', projectId: team, startedAt: new Date(), lastNotifiedAt: new Date(), value: 35 })
      .returning({ id: alertEvent.id });
    return String(event?.id);
  };

  const recorded = async (eventId: string): Promise<DeliveryRecord[]> => {
    const [row] = await db.select().from(alertEvent).where(eq(alertEvent.id, Number(eventId)));
    return row?.deliveries ?? [];
  };

  it('start reaches every channel', async () => {
    const id = await makeEvent([slackId, hookId]);
    await deliveries.notify(id, 'firing');

    const link = `${TEST_ORIGIN}/projects/${team}/monitoring`;
    const line = 'Silent · Web to Magicline · no calls for 35 min (threshold 30 min)';
    const slack = calls.find((call) => call.url === SLACK_URL);
    const hook = calls.find((call) => call.url === HOOK_URL);
    assert.equal(slack?.body.text, `${line}\n${link}`);
    assert.equal(hook?.body.url, link);
    assert.equal(hook?.body.state, 'firing');
    assert.deepEqual(hook?.body.rule, { id: 'rule-1', name: 'Web to Magicline', kind: 'silent' });

    const stored = await recorded(id);
    assert.equal(stored.length, 2);
    assert.ok(stored.every((entry) => entry.ok && entry.status === 200 && entry.attempts === 1 && entry.state === 'firing'));
    assert.deepEqual(stored.map((entry) => entry.channelName).sort(), ['Ops Slack', 'Pager']);
  });

  it('retries a failing send twice, waiting 2 s and then 8 s', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(500), reply(500), reply(200)]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [2000, 8000]);
    const [entry] = await recorded(id);
    assert.deepEqual([entry?.ok, entry?.attempts, entry?.status], [true, 3, 200]);
  });

  it('gives up after three attempts', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(503)]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 3);
    const [entry] = await recorded(id);
    assert.deepEqual([entry?.ok, entry?.attempts, entry?.status], [false, 3, 503]);
  });

  it('does not retry a 4xx other than 429', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(404)]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
    const [entry] = await recorded(id);
    assert.deepEqual([entry?.ok, entry?.attempts, entry?.status], [false, 1, 404]);
  });

  it('honours Retry-After on 429 up to 60 s', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(429, 5), reply(200)]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [5000]);
  });

  it('gives up on 429 when Retry-After is longer than 60 s', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(429, 120)]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
    const [entry] = await recorded(id);
    assert.deepEqual([entry?.ok, entry?.status, entry?.attempts], [false, 429, 1]);
  });

  it('backs off normally on 429 without Retry-After', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [reply(429), reply(200)]);
    await deliveries.notify(id, 'firing');
    assert.deepEqual(sleeps, [2000]);
  });

  it('records a network error when the send throws', async () => {
    const id = await makeEvent([hookId]);
    answers.set(HOOK_URL, [new TypeError('boom with secret'), new TypeError('boom')]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 3);
    const [entry] = await recorded(id);
    assert.deepEqual([entry?.ok, entry?.error, entry?.status], [false, 'network', null]);
  });

  it('records a missing channel and still sends to the others', async () => {
    const id = await makeEvent(['gone', hookId]);
    await deliveries.notify(id, 'reminder');
    assert.equal(calls.length, 1);
    const stored = await recorded(id);
    const gone = stored.find((entry) => entry.channelId === 'gone');
    assert.deepEqual([gone?.ok, gone?.error, gone?.attempts, gone?.channelName], [false, 'missing', 0, null]);
    assert.equal(stored.find((entry) => entry.channelId === hookId)?.ok, true);
  });

  it('records a stored credential that is not a channel as missing', async () => {
    const [row] = await db.select().from(credential).where(eq(credential.id, hookId));
    assert.ok(row);
    await db.insert(credential).values({ ...row, id: 'source-cred', type: 'beszel' });
    const id = await makeEvent(['source-cred']);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 0);
    assert.equal((await recorded(id))[0]?.error, 'missing');
    await db.delete(credential).where(eq(credential.id, 'source-cred'));
  });

  it('stores the status and never a response body', async () => {
    const id = await makeEvent([hookId, slackId]);
    answers.set(HOOK_URL, [{ ...reply(500), body: BODY_TEXT } as PostResult, reply(200)]);
    await deliveries.notify(id, 'firing');
    assert.ok(!JSON.stringify(await recorded(id)).includes(BODY_TEXT));
  });

  it('keeps only the last 50 deliveries', async () => {
    const id = await makeEvent([hookId]);
    for (let round = 0; round < 55; round += 1) await deliveries.notify(id, 'reminder');
    const stored = await recorded(id);
    assert.equal(stored.length, 50);
    assert.ok(stored.every((entry) => entry.state === 'reminder'));
  });

  it('keeps every record of parallel notifications', async () => {
    const id = await makeEvent([hookId, slackId]);
    await Promise.all([deliveries.notify(id, 'firing'), deliveries.notify(id, 'reminder')]);
    assert.equal((await recorded(id)).length, 4);
  });

  it('does nothing for an unknown event or a rule without channels', async () => {
    await deliveries.notify('999999', 'firing');
    const id = await makeEvent([]);
    await deliveries.notify(id, 'firing');
    assert.equal(calls.length, 0);
    assert.deepEqual(await recorded(id), []);
  });

  it('says how long a resolved alert lasted', async () => {
    const id = await makeEvent([slackId], { kind: 'failing', threshold: 5, windowMinutes: 1, target: { type: 'box', identity: 'service:web' } });
    const resolvedAt = new Date(Date.now() + 95 * 60_000);
    await db.update(alertEvent).set({ resolvedAt }).where(eq(alertEvent.id, Number(id)));
    await deliveries.notify(id, 'resolved');
    assert.match(String(calls[0]?.body.text), /^Resolved · Web to Magicline · failing for 1 h 3[45] min\n/);
  });

  it('puts the call count of a failing rule into the message', async () => {
    const id = await makeEvent([slackId], { kind: 'failing', threshold: 5, windowMinutes: 5 });
    await db.insert(trafficMinute).values({
      projectId: team,
      kind: 'incoming',
      caller: 'service:web',
      callee: 'service:web',
      operation: 'GET /',
      minute: new Date(Math.floor(Date.now() / 60_000) * 60_000),
      calls: 1260,
      failures: 52,
      durationSumMs: 1260,
      histogram: emptyHistogram()
    });
    await deliveries.notify(id, 'firing');
    assert.match(
      String(calls[0]?.body.text),
      /^Failing · Web to Magicline · 35% of 1,260 calls failed in the last 5 min \(threshold 5%\)\n/
    );
    await db.delete(trafficMinute);
  });
});
