import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { alertEvent, alertRule } from '../database/schema.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person } from '../test/people.js';
import { matchesIdentity } from './targets.js';

const failing = (overrides: object = {}) => ({
  name: 'Web to Magicline',
  kind: 'failing',
  target: { type: 'arrow', from: 'service:web', to: 'host:*.magicline.com' },
  threshold: 2,
  windowMinutes: 5,
  ...overrides
});

const silent = (overrides: object = {}) => ({
  name: 'Quiet web',
  kind: 'silent',
  target: { type: 'box', identity: 'service:web' },
  windowMinutes: 30,
  ...overrides
});

describe('alert rules and history against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let owner: Browser;
  let mia: Person; // team editor
  let vic: Person; // team viewer
  let eve: Person; // outsider
  let team: string;
  let other: string;
  let slack: string;
  let beszel: string;
  let foreign: string;
  const rules = (project = team) => `/api/projects/${project}/alert-rules`;

  const credentialIn = async (project: string, body: object): Promise<string> => {
    const response = await owner.post(`/api/projects/${project}/credentials`, body);
    assert.equal(response.status, 201);
    return response.body.id;
  };

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    owner = t.browser();
    await owner.post('/api/setup/owner', { name: 'Olivia', email: 'owner@example.com', password: 'Owner-pass-1' });
    mia = await joinAs(t, owner, 'Mia');
    vic = await joinAs(t, owner, 'Vic');
    eve = await joinAs(t, owner, 'Eve');
    team = (await owner.post('/api/projects', { name: 'Infrastructure' })).body.id;
    other = (await owner.post('/api/projects', { name: 'Elsewhere' })).body.id;
    await owner.put(`/api/projects/${team}/members/${mia.id}`, { role: 'project:editor' });
    await owner.put(`/api/projects/${team}/members/${vic.id}`, { role: 'project:viewer' });
    const hook = { type: 'slack', settings: { url: 'https://hooks.slack.com/services/T0/B0/xyz' } };
    slack = await credentialIn(team, { name: 'Ops', ...hook });
    foreign = await credentialIn(other, { name: 'Other ops', ...hook });
    beszel = await credentialIn(team, {
      name: 'Hub',
      type: 'beszel',
      settings: { url: 'https://hub.example.com', email: 'a@example.com', password: 'x' }
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('matches identities like the lib does', () => {
    assert.ok(matchesIdentity('host:*.magicline.com', 'host:api.magicline.com'));
    assert.ok(!matchesIdentity('host:*.magicline.com', 'host:.magicline.com'));
    assert.ok(matchesIdentity('service:web', 'service:web'));
    assert.ok(!matchesIdentity('service:web', 'service:web2'));
  });

  it('creates a failing arrow rule as ok and a silent rule as waiting', async () => {
    const created = await mia.browser.post(rules(), failing({ channelIds: [slack] }));
    assert.equal(created.status, 201);
    assert.equal(created.body.state, 'ok');
    assert.equal(created.body.minCalls, 10);
    assert.equal(created.body.enabled, true);
    assert.deepEqual(created.body.channelIds, [slack]);
    assert.equal(created.body.activeSince, null);

    const quiet = await mia.browser.post(rules(), silent());
    assert.equal(quiet.status, 201);
    assert.equal(quiet.body.state, 'waiting');
    assert.equal(quiet.body.threshold, null);

    const list = await vic.browser.get(rules());
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
  });

  it('rejects bad rules and names the field', async () => {
    const cases: [object, string][] = [
      [failing({ threshold: undefined }), 'threshold'],
      [failing({ threshold: 150 }), 'threshold'],
      [silent({ windowMinutes: 3000 }), 'windowMinutes'],
      [silent({ threshold: 5 }), 'threshold'],
      [failing({ target: { type: 'box', identity: 'ftp:x' } }), 'target.identity'],
      [failing({ target: { type: 'box', identity: 'host:a*b' } }), 'target.identity'],
      [failing({ name: 'n'.repeat(101) }), 'name'],
      [failing({ name: 'two\nlines' }), 'name'],
      [failing({ channelIds: Array.from({ length: 11 }, (_, i) => `c${i}`) }), 'channelIds'],
      [failing({ channelIds: [foreign] }), 'channelIds'],
      [failing({ channelIds: [beszel] }), 'channelIds']
    ];
    for (const [body, field] of cases) {
      const response = await mia.browser.post(rules(), body);
      assert.equal(response.status, 400, field);
      const paths = (response.body.issues as { path: string }[]).map((issue) => issue.path);
      assert.ok(paths.includes(field), `${field} in ${paths.join(',')}`);
    }
  });

  it('updates a rule, switching kind and re-checking channels', async () => {
    const created = await mia.browser.post(rules(), failing({ name: 'Patch me' }));
    const id = created.body.id as string;
    const slow = await mia.browser.patch(`/api/alert-rules/${id}`, { kind: 'slow', threshold: 800, name: 'Slow now' });
    assert.equal(slow.status, 200);
    assert.deepEqual([slow.body.kind, slow.body.threshold, slow.body.name], ['slow', 800, 'Slow now']);
    const bad = await mia.browser.patch(`/api/alert-rules/${id}`, { channelIds: [foreign] });
    assert.equal(bad.status, 400);
    const quiet = await mia.browser.patch(`/api/alert-rules/${id}`, { kind: 'silent', windowMinutes: 10 });
    assert.equal(quiet.status, 200);
    assert.deepEqual([quiet.body.state, quiet.body.threshold], ['waiting', null]);
    assert.equal((await mia.browser.delete(`/api/alert-rules/${id}`)).status, 204);
    assert.equal((await mia.browser.delete(`/api/alert-rules/${id}`)).status, 404);
  });

  it('keeps a silent rule armed on edits that keep its target, and re-arms it when the target changes', async () => {
    const created = await mia.browser.post(
      rules(),
      silent({ name: 'Armed arrow', target: { type: 'arrow', from: 'service:web', to: 'host:api.example.com' } })
    );
    const id = created.body.id as string;
    const armedAt = new Date(Date.now() - 600_000);
    await db.update(alertRule).set({ armedAt }).where(eq(alertRule.id, id));

    const renamed = await mia.browser.patch(`/api/alert-rules/${id}`, { name: 'Renamed' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.state, 'ok');
    const [kept] = await db.select().from(alertRule).where(eq(alertRule.id, id));
    assert.equal(kept?.armedAt?.getTime(), armedAt.getTime());

    const moved = await mia.browser.patch(`/api/alert-rules/${id}`, {
      target: { type: 'arrow', from: 'service:web', to: 'host:other.example.com' }
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.state, 'waiting');
    const [reset] = await db.select().from(alertRule).where(eq(alertRule.id, id));
    assert.equal(reset?.armedAt, null);
  });

  it('keeps viewers read-only and outsiders out', async () => {
    const [existing] = (await owner.get(rules())).body as { id: string }[];
    assert.ok(existing);
    assert.equal((await vic.browser.get(`/api/projects/${team}/alerts`)).status, 200);
    assert.equal((await vic.browser.post(rules(), failing())).status, 403);
    assert.equal((await vic.browser.patch(`/api/alert-rules/${existing.id}`, { name: 'x' })).status, 403);
    assert.equal((await vic.browser.delete(`/api/alert-rules/${existing.id}`)).status, 403);

    assert.equal((await eve.browser.get(rules())).status, 404);
    assert.equal((await eve.browser.get(`/api/projects/${team}/alerts`)).status, 404);
    assert.equal((await eve.browser.post(rules(), failing())).status, 404);
    assert.equal((await eve.browser.patch(`/api/alert-rules/${existing.id}`, { name: 'x' })).status, 404);
    assert.equal((await eve.browser.delete(`/api/alert-rules/${existing.id}`)).status, 404);

    const anonymous = t.browser();
    assert.equal((await anonymous.get(rules())).status, 401);
    assert.equal((await anonymous.get(`/api/projects/${team}/alerts`)).status, 401);
    assert.equal((await anonymous.post(rules(), failing())).status, 401);
    assert.equal((await anonymous.patch(`/api/alert-rules/${existing.id}`, {})).status, 401);
    assert.equal((await anonymous.delete(`/api/alert-rules/${existing.id}`)).status, 401);
  });

  it('closes the open event quietly when a rule is disabled', async () => {
    const created = await mia.browser.post(rules(), failing({ name: 'Disable me' }));
    const id = created.body.id as string;
    const now = new Date();
    await db.insert(alertEvent).values({ ruleId: id, projectId: team, startedAt: now, lastNotifiedAt: now, value: 5 });

    const listed = (await mia.browser.get(rules())).body as { id: string; state: string }[];
    assert.equal(listed.find((rule) => rule.id === id)?.state, 'firing');

    const off = await mia.browser.patch(`/api/alert-rules/${id}`, { enabled: false });
    assert.equal(off.status, 200);
    assert.deepEqual([off.body.enabled, off.body.state], [false, 'ok']);
    const [event] = await db.select().from(alertEvent).where(eq(alertEvent.ruleId, id));
    assert.ok(event?.resolvedAt);
    assert.deepEqual(event.deliveries, []);
  });

  it('closes the open event quietly when a rule is retargeted, not on a rename', async () => {
    const created = await mia.browser.post(rules(), failing({ name: 'Retarget me' }));
    const id = created.body.id as string;
    const now = new Date();
    await db.insert(alertEvent).values({ ruleId: id, projectId: team, startedAt: now, lastNotifiedAt: now, value: 5 });
    const eventOf = async () => (await db.select().from(alertEvent).where(eq(alertEvent.ruleId, id)))[0];

    assert.equal((await mia.browser.patch(`/api/alert-rules/${id}`, { name: 'Renamed' })).status, 200);
    assert.equal((await eventOf())?.resolvedAt, null);

    const moved = await mia.browser.patch(`/api/alert-rules/${id}`, {
      target: { type: 'arrow', from: 'service:web', to: 'host:elsewhere.example.com' }
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.state, 'ok');
    const event = await eventOf();
    assert.ok(event?.resolvedAt);
    assert.deepEqual(event.deliveries, []);
  });

  it('keeps a rule editable after a channel is deleted, and still checks new channels', async () => {
    const gone = await credentialIn(team, {
      name: 'Gone',
      type: 'slack',
      settings: { url: 'https://hooks.slack.com/services/T0/B0/gone' }
    });
    const created = await mia.browser.post(rules(), failing({ name: 'Two channels', channelIds: [slack, gone] }));
    const id = created.body.id as string;
    assert.equal((await owner.delete(`/api/credentials/${gone}`)).status, 204);

    const [stored] = await db.select().from(alertRule).where(eq(alertRule.id, id));
    assert.deepEqual(stored?.channelIds, [slack]);

    const off = await mia.browser.patch(`/api/alert-rules/${id}`, { enabled: false });
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.channelIds, [slack]);

    // A stale id that slipped in some other way is dropped, not an error.
    await db.update(alertRule).set({ channelIds: [slack, 'vanished'] }).where(eq(alertRule.id, id));
    const toggled = await mia.browser.patch(`/api/alert-rules/${id}`, { enabled: true });
    assert.equal(toggled.status, 200);
    assert.deepEqual(toggled.body.channelIds, [slack]);

    assert.equal((await mia.browser.patch(`/api/alert-rules/${id}`, { channelIds: [slack, foreign] })).status, 400);
    assert.equal((await mia.browser.patch(`/api/alert-rules/${id}`, { channelIds: [slack, beszel] })).status, 400);
  });

  it('pages alert history', async () => {
    const [rule] = await db.select().from(alertRule).where(eq(alertRule.projectId, team)).limit(1);
    assert.ok(rule);
    const base = Date.now() - 3_600_000;
    for (let index = 0; index < 4; index += 1) {
      const startedAt = new Date(base + index * 60_000);
      await db.insert(alertEvent).values({
        ruleId: rule.id,
        projectId: team,
        startedAt,
        resolvedAt: new Date(startedAt.getTime() + 30_000),
        lastNotifiedAt: startedAt
      });
    }
    await db.insert(alertEvent).values({ ruleId: rule.id, projectId: team, startedAt: new Date(), lastNotifiedAt: new Date() });

    const active = (await vic.browser.get(`/api/projects/${team}/alerts?state=active`)).body as { id: string; resolvedAt: string | null; ruleName: string }[];
    assert.ok(active.length >= 1);
    assert.ok(active.every((event) => event.resolvedAt === null));
    assert.equal(active[0]?.ruleName, rule.name);

    const first = (await vic.browser.get(`/api/projects/${team}/alerts?state=resolved&limit=2`)).body as { id: string; resolvedAt: string | null }[];
    assert.equal(first.length, 2);
    assert.ok(first.every((event) => event.resolvedAt !== null));
    const lastId = first[1]?.id ?? '';
    const next = (await vic.browser.get(`/api/projects/${team}/alerts?state=resolved&limit=2&before=${lastId}`)).body as { id: string }[];
    assert.ok(next.length >= 1);
    assert.ok(next.every((event) => Number(event.id) < Number(lastId)));
    assert.ok(!next.some((event) => first.some((seen) => seen.id === event.id)));

    assert.equal((await vic.browser.get(`/api/projects/${team}/alerts?limit=51`)).status, 400);
  });

  it('stops at 100 rules per project', async () => {
    const [{ count: existing }] = [{ count: ((await owner.get(rules(other))).body as unknown[]).length }];
    // Filled straight in the database: 100 requests would run into the rate limit.
    await db.insert(alertRule).values(
      Array.from({ length: 100 - existing }, (_, index) => ({
        id: `filler-${index}`,
        projectId: other,
        name: `Rule ${existing + index}`,
        kind: 'silent' as const,
        target: { type: 'box' as const, identity: 'service:web' },
        windowMinutes: 30
      }))
    );
    const over = await owner.post(rules(other), failing());
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'This project already has 100 alert rules');
  });
});
