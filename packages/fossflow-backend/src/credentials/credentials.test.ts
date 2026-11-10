import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from '../app.js';
import { DB, type Database } from '../database/database.module.js';
import { credential, meta } from '../database/schema.js';
import { demoLandscape, type FakeBeszel, startFakeBeszel } from '../live/testing/fakeBeszel.js';
import type { LiveSnapshot } from '../live/types.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';

interface Person {
  browser: Browser;
  id: string;
}

const tokenOf = (url: string) => url.split('/invite/')[1] ?? '';

async function joinAs(t: TestApp, inviter: Browser, name: string): Promise<Person> {
  const invite = await inviter.post('/api/invitations', {
    email: `${name.toLowerCase()}@example.com`,
    instanceRole: 'global:member'
  });
  const browser = t.browser();
  await browser.post(`/api/invitations/accept/${tokenOf(invite.body.url)}`, {
    name,
    password: `${name}-pass-1A`
  });
  const session = await browser.get('/api/auth/get-session');
  return { browser, id: session.body.user.id };
}

const personalOf = async (browser: Browser): Promise<string> =>
  ((await browser.get('/api/projects')).body as { id: string; type: string }[]).find(
    (p) => p.type === 'personal'
  )?.id ?? '';

/** Polls the live endpoint until the first sync landed. */
async function liveOnce(browser: Browser, landscapeId: string): Promise<LiveSnapshot> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = (await browser.get(`/api/landscapes/${landscapeId}/live`)).body as LiveSnapshot;
    if (snapshot.updatedAt !== null) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('live data never arrived');
}

const boundModel = (title: string) => ({
  title,
  icons: [],
  colors: [],
  items: [
    { id: 'a', name: 'Web', live: { key: 'beszel:sysweb01' } },
    { id: 'b', name: 'Nginx', live: { key: 'beszel:sysweb01/nginx' } }
  ],
  views: [
    {
      id: 'v1',
      items: [{ id: 'a', tile: { x: 0, y: 0 } }],
      rectangles: [
        {
          from: { x: 0, y: 0 },
          to: { x: 2, y: 2 },
          live: { key: 'beszel:sysweb01', known: ['beszel:sysweb01/nginx'] }
        }
      ]
    }
  ]
});

describe('credentials and live sources against real Postgres', () => {
  let fake: FakeBeszel;
  let t: TestApp;
  let db: Database;
  let owner: Browser;
  let mia: Person; // team editor
  let vic: Person; // team viewer
  let eve: Person; // not in the team
  let team: string;
  let teamCredential: string;
  let teamLandscape: string;
  /** Every response body, to prove the password never leaves the server. */
  const seen: string[] = [];
  const record = <T extends { body: unknown }>(response: T): T => {
    seen.push(JSON.stringify(response.body));
    return response;
  };

  beforeAll(async () => {
    fake = await startFakeBeszel(demoLandscape(Date.now()));
    t = await startTestApp({
      BESZEL_URL: fake.url,
      BESZEL_EMAIL: fake.email,
      BESZEL_PASSWORD: fake.password
    });
    db = t.app.get<Database>(DB);

    // A diagram from the old file storage, bound to the env-configured hub.
    const legacy = join(t.config.dataDir, 'diagrams');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'web.json'), JSON.stringify({ ...boundModel('Web'), name: 'Web tier' }));

    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    mia = await joinAs(t, owner, 'Mia');
    vic = await joinAs(t, owner, 'Vic');
    eve = await joinAs(t, owner, 'Eve');

    team = (await owner.post('/api/projects', { name: 'Infrastructure' })).body.id;
    await owner.put(`/api/projects/${team}/members/${mia.id}`, { role: 'project:editor' });
    await owner.put(`/api/projects/${team}/members/${vic.id}`, { role: 'project:viewer' });
    teamLandscape = (await mia.browser.post(`/api/projects/${team}/landscapes`, { name: 'Racks' })).body.id;
  });
  afterAll(async () => {
    await t?.close();
    await fake?.close();
  });

  it('moves the BESZEL_* login into a credential once and rebinds old diagrams', async () => {
    const personal = await personalOf(owner);
    const list = record(await owner.get(`/api/projects/${personal}/credentials`));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    const [moved] = list.body as { id: string; name: string; type: string; usedBy: number }[];
    assert.equal(moved?.name, 'Beszel');
    assert.equal(moved?.type, 'beszel');
    assert.equal(moved?.usedBy, 1);

    const landscapes = (await owner.get(`/api/projects/${personal}/landscapes`)).body as { id: string; name: string }[];
    const web = landscapes.find((l) => l.name === 'Web tier');
    assert.ok(web);
    const saved = (await owner.get(`/api/landscapes/${web.id}`)).body;
    assert.deepEqual(
      saved.model.items.map((item: { live: { key: string } }) => item.live.key),
      [`${moved?.id}:sysweb01`, `${moved?.id}:sysweb01/nginx`]
    );
    assert.deepEqual(saved.model.views[0].rectangles[0].live, {
      key: `${moved?.id}:sysweb01`,
      known: [`${moved?.id}:sysweb01/nginx`]
    });
    assert.deepEqual(
      (await owner.get(`/api/landscapes/${web.id}/sources`)).body,
      [{ id: moved?.id, name: 'Beszel', type: 'beszel' }]
    );

    // Live data for the rebound landscape, keyed by the new credential.
    const live = record(await liveOnce(owner, web.id).then((body) => ({ body }))).body;
    assert.equal(live.systems.length, 2);
    assert.ok(live.systems.every((system) => system.key.startsWith(`${moved?.id}:`)));
    assert.deepEqual(live.sources.map((source) => [source.name, source.ok]), [['Beszel', true]]);

    // A restart doesn't move it again.
    const again = await createApp(t.config);
    await again.init();
    await again.close();
    assert.equal((await owner.get(`/api/projects/${personal}/credentials`)).body.length, 1);
    const [flag] = await db.select().from(meta).where(eq(meta.key, 'migration.envBeszel'));
    assert.ok(flag);
  });

  it('lists the connectors with their credential forms', async () => {
    const response = record(await vic.browser.get('/api/connectors'));
    assert.equal(response.status, 200);
    const beszel = (response.body as { id: string; fields: { name: string; secret: boolean }[] }[]).find(
      (connector) => connector.id === 'beszel'
    );
    assert.deepEqual(
      beszel?.fields.map((field) => [field.name, field.secret]),
      [['url', false], ['email', false], ['password', true]]
    );
  });

  it('creates a credential, tests it, and stores it encrypted', async () => {
    const created = record(
      await mia.browser.post(`/api/projects/${team}/credentials`, {
        name: 'Lab hub',
        type: 'beszel',
        settings: { url: `${fake.url}/`, email: fake.email, password: fake.password }
      })
    );
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.test, { ok: true, message: 'Connected: 2 servers visible' });
    teamCredential = created.body.id;

    const detail = record(await mia.browser.get(`/api/credentials/${teamCredential}`));
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.settings, { url: fake.url, email: fake.email });
    assert.deepEqual(detail.body.secretsSet, ['password']);

    const [row] = await db.select({ data: credential.data }).from(credential).where(eq(credential.id, teamCredential));
    assert.ok(row);
    assert.ok(row.data.startsWith('v1:'));
    assert.ok(!row.data.includes(fake.password) && !row.data.includes(fake.email));
  });

  it('reports connection problems and rejects bad settings', async () => {
    const wrong = record(
      await mia.browser.post(`/api/projects/${team}/credentials`, {
        name: 'Typo',
        type: 'beszel',
        settings: { url: fake.url, email: fake.email, password: 'not-the-password' }
      })
    );
    assert.equal(wrong.status, 201);
    assert.equal(wrong.body.test.ok, false);
    await mia.browser.delete(`/api/credentials/${wrong.body.id}`);

    const bad = [
      { type: 'beszel', settings: { url: 'ftp://hub.example.com', email: fake.email, password: 'x' } },
      { type: 'beszel', settings: { url: 'https://user:pw@hub.example.com', email: fake.email, password: 'x' } },
      { type: 'beszel', settings: { url: fake.url, email: 'not-an-email', password: 'x' } },
      { type: 'beszel', settings: { url: fake.url, email: fake.email } },
      { type: 'nope', settings: {} }
    ];
    for (const body of bad) {
      const response = record(await mia.browser.post(`/api/projects/${team}/credentials`, { name: 'Bad', ...body }));
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('keeps the stored password when an edit leaves it empty', async () => {
    const renamed = record(
      await mia.browser.patch(`/api/credentials/${teamCredential}`, {
        name: 'Lab Beszel',
        settings: { password: '' }
      })
    );
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.test.ok, true);
    assert.equal((await mia.browser.get(`/api/credentials/${teamCredential}`)).body.name, 'Lab Beszel');

    const retest = record(await mia.browser.post(`/api/credentials/${teamCredential}/test`));
    assert.deepEqual(retest.body, { ok: true, message: 'Connected: 2 servers visible' });
  });

  it('never sends a kept password to a new address', async () => {
    // Otherwise anyone who can edit could point it at their own server and read it there.
    const redirected = record(
      await mia.browser.patch(`/api/credentials/${teamCredential}`, {
        settings: { url: 'https://collector.example', email: fake.email, password: '' }
      })
    );
    assert.equal(redirected.status, 400);
    assert.match(redirected.body.error, /password again/);
    const newEmail = await mia.browser.patch(`/api/credentials/${teamCredential}`, {
      settings: { email: 'someone@example.com' }
    });
    assert.equal(newEmail.status, 400);
    assert.equal((await mia.browser.get(`/api/credentials/${teamCredential}`)).body.settings.url, fake.url);

    // The same address, written differently, is not a change.
    const same = await mia.browser.patch(`/api/credentials/${teamCredential}`, {
      settings: { url: `${fake.url}/`, email: fake.email, password: '' }
    });
    assert.equal(same.status, 200);
  });

  it('lets viewers see names only, and hides other projects', async () => {
    const list = record(await vic.browser.get(`/api/projects/${team}/credentials`));
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body[0]).sort(), ['id', 'name', 'type', 'updatedAt', 'usedBy']);

    const id = teamCredential;
    assert.equal((await vic.browser.get(`/api/credentials/${id}`)).status, 403);
    assert.equal((await vic.browser.post(`/api/credentials/${id}/test`)).status, 403);
    assert.equal((await vic.browser.patch(`/api/credentials/${id}`, { name: 'x' })).status, 403);
    assert.equal((await vic.browser.delete(`/api/credentials/${id}`)).status, 403);
    assert.equal(
      (await vic.browser.post(`/api/projects/${team}/credentials`, { name: 'x', type: 'beszel', settings: {} })).status,
      403
    );
    assert.equal(
      (await vic.browser.put(`/api/landscapes/${teamLandscape}/sources`, { credentialIds: [id] })).status,
      403
    );

    assert.equal((await eve.browser.get(`/api/projects/${team}/credentials`)).status, 404);
    assert.equal((await eve.browser.get(`/api/credentials/${id}`)).status, 404);
    assert.equal((await eve.browser.get(`/api/landscapes/${teamLandscape}/live`)).status, 404);
  });

  it('attaches credentials of the same project only, and serves their live data', async () => {
    const personalCredential = (
      await owner.get(`/api/projects/${await personalOf(owner)}/credentials`)
    ).body[0].id;
    const foreign = await owner.put(`/api/landscapes/${teamLandscape}/sources`, {
      credentialIds: [personalCredential]
    });
    assert.equal(foreign.status, 400);

    const attached = await mia.browser.put(`/api/landscapes/${teamLandscape}/sources`, {
      credentialIds: [teamCredential]
    });
    assert.equal(attached.status, 200);
    assert.deepEqual((await vic.browser.get(`/api/landscapes/${teamLandscape}/sources`)).body, [
      { id: teamCredential, name: 'Lab Beszel', type: 'beszel' }
    ]);
    assert.equal((await mia.browser.get(`/api/projects/${team}/credentials`)).body[0].usedBy, 1);

    // Viewers see the live data of landscapes they can read.
    const live = record({ body: await liveOnce(vic.browser, teamLandscape) }).body;
    assert.equal(live.systems.length, 2);
    assert.ok(live.systems.every((system) => system.key.startsWith(`${teamCredential}:`)));
    assert.equal(live.sources[0]?.name, 'Lab Beszel');
  });

  it('detaches a credential when it is deleted, and sources when a landscape moves', async () => {
    const spare = (
      await mia.browser.post(`/api/projects/${team}/credentials`, {
        name: 'Spare',
        type: 'beszel',
        settings: { url: fake.url, email: fake.email, password: fake.password }
      })
    ).body.id;
    await mia.browser.put(`/api/landscapes/${teamLandscape}/sources`, {
      credentialIds: [teamCredential, spare]
    });
    assert.equal((await mia.browser.delete(`/api/credentials/${spare}`)).status, 204);
    assert.deepEqual(
      ((await mia.browser.get(`/api/landscapes/${teamLandscape}/sources`)).body as { id: string }[]).map((s) => s.id),
      [teamCredential]
    );

    const moved = await owner.post(`/api/landscapes/${teamLandscape}/move`, {
      projectId: await personalOf(owner)
    });
    assert.equal(moved.status, 200);
    assert.deepEqual((await owner.get(`/api/landscapes/${teamLandscape}/sources`)).body, []);
    assert.deepEqual(
      (await owner.get(`/api/landscapes/${teamLandscape}/live`)).body,
      { updatedAt: null, systems: [], sources: [] }
    );
  });

  it('never sends a password back', () => {
    const text = seen.join('\n');
    assert.ok(seen.length > 10);
    assert.ok(!text.includes(fake.password), 'a response contained the Beszel password');
  });
});
