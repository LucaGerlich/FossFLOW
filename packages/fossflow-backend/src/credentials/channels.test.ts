import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { POST_JSON, type PostResult } from '../connectors/outbound.js';
import { TEST_DEADLINE_MS } from './credentials.service.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person } from '../test/people.js';

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/secret-token';

interface Call {
  url: string;
  body: { text?: string };
  allowPrivate: boolean;
}

describe('alert channels as credentials', () => {
  let t: TestApp;
  let smtp: TestApp;
  let owner: Browser;
  let mia: Person; // editor
  let vic: Person; // viewer
  let eve: Person; // outsider
  let team: string;
  let landscape: string;
  const calls: Call[] = [];
  let answer: PostResult = { ok: true, status: 200, retryAfterSeconds: null, error: null };

  let never: Promise<never> | null = null;

  const postJson = async (url: URL, body: unknown, options: { allowPrivate: boolean }) => {
    if (never) return never;
    calls.push({ url: url.toString(), body: body as Call['body'], allowPrivate: options.allowPrivate });
    return answer;
  };

  beforeAll(async () => {
    t = await startTestApp({}, [
      { provide: POST_JSON, useValue: postJson },
      { provide: TEST_DEADLINE_MS, useValue: 200 }
    ]);
    owner = t.browser();
    await owner.post('/api/setup/owner', { name: 'Olivia', email: 'owner@example.com', password: 'Owner-pass-1' });
    mia = await joinAs(t, owner, 'Mia');
    vic = await joinAs(t, owner, 'Vic');
    eve = await joinAs(t, owner, 'Eve');
    team = (await owner.post('/api/projects', { name: 'Infrastructure' })).body.id;
    await owner.put(`/api/projects/${team}/members/${mia.id}`, { role: 'project:editor' });
    await owner.put(`/api/projects/${team}/members/${vic.id}`, { role: 'project:viewer' });
    landscape = (await mia.browser.post(`/api/projects/${team}/landscapes`, { name: 'Racks' })).body.id;
    smtp = await startTestApp({ SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'fossflow@example.com' });
  });
  afterAll(async () => {
    await t?.close();
    await smtp?.close();
  });
  beforeEach(() => {
    calls.length = 0;
    answer = { ok: true, status: 200, retryAfterSeconds: null, error: null };
  });

  const kinds = (body: { id: string; kind: string }[]) => Object.fromEntries(body.map((c) => [c.id, c.kind]));

  it('lists channels next to Beszel, and email only with SMTP', async () => {
    const response = await vic.browser.get('/api/connectors');
    assert.equal(response.status, 200);
    assert.deepEqual(kinds(response.body), {
      beszel: 'source',
      slack: 'channel',
      teams: 'channel',
      webhook: 'channel'
    });

    const admin = smtp.browser();
    await admin.post('/api/setup/owner', { name: 'Ada', email: 'ada@example.com', password: 'Owner-pass-1' });
    const withSmtp = await admin.get('/api/connectors');
    assert.equal(kinds(withSmtp.body).email, 'channel');
  });

  it('sends a test message on create and stores the credential', async () => {
    const created = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Ops Slack',
      type: 'slack',
      settings: { url: SLACK_URL }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.test, { ok: true, message: 'Test message sent' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, SLACK_URL);
    assert.ok(calls[0]?.body.text?.startsWith('Test · Infrastructure'));
    assert.ok(calls[0]?.body.text?.includes(`/projects/${team}/monitoring`));
    assert.equal(calls[0]?.allowPrivate, false);

    const list = await vic.browser.get(`/api/projects/${team}/credentials`);
    const entry = (list.body as { id: string; kind: string; type: string }[]).find((c) => c.id === created.body.id);
    assert.equal(entry?.kind, 'channel');
    assert.equal(entry?.type, 'slack');

    const detail = await mia.browser.get(`/api/credentials/${created.body.id}`);
    assert.deepEqual(detail.body.secretsSet, ['url']);
    assert.deepEqual(detail.body.settings, {});
    assert.ok(!JSON.stringify(detail.body).includes('secret-token'));

    const again = await mia.browser.post(`/api/credentials/${created.body.id}/test`);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ok: true, message: 'Test message sent' });
    assert.equal(calls.length, 2);
  });

  it('keeps the credential when the test is not delivered', async () => {
    answer = { ok: false, status: 404, retryAfterSeconds: null, error: null };
    const created = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Stale hook',
      type: 'slack',
      settings: { url: SLACK_URL }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.test, { ok: false, message: 'Not delivered (404)' });
    assert.equal((await mia.browser.get(`/api/credentials/${created.body.id}`)).status, 200);

    answer = { ok: false, status: null, retryAfterSeconds: null, error: 'timeout' };
    const retried = await mia.browser.post(`/api/credentials/${created.body.id}/test`);
    assert.deepEqual(retried.body, { ok: false, message: 'Not delivered (timeout)' });
  });

  it('reports a timeout when the channel never answers', async () => {
    const created = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Silent hook',
      type: 'slack',
      settings: { url: 'https://hooks.slack.com/services/T0/B0/silent' }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.test, { ok: true, message: 'Test message sent' });
    never = new Promise<never>(() => {});
    const started = Date.now();
    const retried = await mia.browser.post(`/api/credentials/${created.body.id}/test`);
    never = null;
    assert.equal(retried.status, 200);
    assert.deepEqual(retried.body, { ok: false, message: 'Not delivered (timeout)' });
    assert.ok(Date.now() - started < 3000);
  });

  it('rejects settings that do not fit the channel', async () => {
    const response = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Evil',
      type: 'slack',
      settings: { url: 'https://evil.io/services/x' }
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /url/);
    assert.equal(calls.length, 0);
  });

  it('refuses an email channel without SMTP', async () => {
    const response = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Mail',
      type: 'email',
      settings: { to: 'ops@example.com' }
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Email needs SMTP to be configured' });
  });

  it('does not attach a channel to a landscape', async () => {
    const created = await mia.browser.post(`/api/projects/${team}/credentials`, {
      name: 'Hook',
      type: 'slack',
      settings: { url: SLACK_URL }
    });
    const response = await mia.browser.put(`/api/landscapes/${landscape}/sources`, {
      credentialIds: [created.body.id]
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Only data sources can be attached to a landscape' });
  });

  it('keeps viewers and outsiders out', async () => {
    const body = { name: 'Nope', type: 'slack', settings: { url: SLACK_URL } };
    assert.equal((await vic.browser.post(`/api/projects/${team}/credentials`, body)).status, 403);
    assert.equal((await eve.browser.post(`/api/projects/${team}/credentials`, body)).status, 404);
    assert.equal(calls.length, 0);
  });
});
