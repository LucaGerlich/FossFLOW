import assert from 'node:assert/strict';
import pg from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from '../app.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';

interface ProjectSummary {
  id: string;
  name: string;
  type: 'personal' | 'team';
  role: string | null;
  scopes: string[];
}

interface Person {
  browser: Browser;
  id: string;
}

const tokenOf = (url: string) => url.split('/invite/')[1] ?? '';

/** Invites someone and signs them in through the link. */
async function join(
  t: TestApp,
  inviter: Browser,
  name: string,
  instanceRole: 'global:member' | 'global:admin' = 'global:member'
): Promise<Person> {
  const invite = await inviter.post('/api/invitations', {
    email: `${name.toLowerCase()}@example.com`,
    instanceRole
  });
  const browser = t.browser();
  await browser.post(`/api/invitations/accept/${tokenOf(invite.body.url)}`, {
    name,
    password: `${name}-pass-1A`
  });
  const session = await browser.get('/api/auth/get-session');
  return { browser, id: session.body.user.id };
}

const projectsOf = async (browser: Browser) =>
  (await browser.get('/api/projects')).body as ProjectSummary[];

describe('projects and project roles', () => {
  let t: TestApp;
  let owner: Browser;
  let admin: Person;
  let mia: Person;
  let vic: Person;
  let eve: Person;
  let projectId: string;

  const setMember = (by: Browser, who: string, role: string) =>
    by.put(`/api/projects/${projectId}/members/${who}`, { role });

  beforeAll(async () => {
    t = await startTestApp();
    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    admin = await join(t, owner, 'Ada', 'global:admin');
    mia = await join(t, owner, 'Mia');
    vic = await join(t, owner, 'Vic');
    eve = await join(t, owner, 'Eve');
  });
  afterAll(async () => t?.close());

  it('gives every account exactly one personal project', async () => {
    for (const browser of [owner, mia.browser, eve.browser]) {
      const personal = (await projectsOf(browser)).filter((p) => p.type === 'personal');
      assert.equal(personal.length, 1);
      assert.equal(personal[0]?.role, 'project:personalOwner');
      assert.ok(personal[0]?.scopes.includes('landscape:create'));
    }
  });

  it('keeps personal projects private', async () => {
    const mine = (await projectsOf(mia.browser))[0];
    assert.equal((await eve.browser.get(`/api/projects/${mine?.id}`)).status, 404);
    assert.equal((await t.browser().get(`/api/projects/${mine?.id}`)).status, 401);
  });

  it('lets only owners and admins create team projects', async () => {
    assert.equal((await mia.browser.post('/api/projects', { name: 'Infra' })).status, 403);
    assert.equal((await admin.browser.post('/api/projects', { name: ' ' })).status, 400);

    const created = await admin.browser.post('/api/projects', { name: 'Infrastructure' });
    assert.equal(created.status, 201);
    projectId = created.body.id;

    const detail = (await admin.browser.get(`/api/projects/${projectId}`)).body;
    assert.equal(detail.name, 'Infrastructure');
    assert.equal(detail.type, 'team');
    assert.deepEqual(
      detail.members.map((m: { name: string; role: string }) => [m.name, m.role]),
      [['Ada', 'project:admin']]
    );
  });

  it('shows team projects to their members and to every owner or admin', async () => {
    const team = (await projectsOf(owner)).find((p) => p.id === projectId);
    assert.equal(team?.role, null, 'the owner sees it without being a member');
    assert.ok(team?.scopes.includes('projectMember:manage'));

    assert.ok(!(await projectsOf(mia.browser)).some((p) => p.id === projectId));
    assert.equal((await mia.browser.get(`/api/projects/${projectId}`)).status, 404);
  });

  it('adds members whose role decides what they can do', async () => {
    const candidates = (await admin.browser.get(`/api/projects/${projectId}/candidates`))
      .body as { id: string }[];
    assert.ok(candidates.some((c) => c.id === mia.id));
    assert.ok(!candidates.some((c) => c.id === admin.id), 'members are not candidates');

    assert.equal((await setMember(admin.browser, mia.id, 'project:editor')).status, 200);
    assert.equal((await setMember(admin.browser, vic.id, 'project:viewer')).status, 200);
    assert.equal((await setMember(admin.browser, vic.id, 'project:owner')).status, 400);
    assert.equal((await setMember(admin.browser, 'nobody', 'project:viewer')).status, 404);

    const miaView = (await mia.browser.get(`/api/projects/${projectId}`)).body;
    assert.equal(miaView.role, 'project:editor');
    assert.ok(miaView.scopes.includes('landscape:update'));
    assert.ok(!miaView.scopes.includes('projectMember:manage'));

    const vicView = (await vic.browser.get(`/api/projects/${projectId}`)).body;
    assert.deepEqual(
      [...vicView.scopes].sort(),
      ['credential:read', 'landscape:read', 'project:read']
    );
  });

  it('keeps editors and viewers out of project settings', async () => {
    for (const member of [mia, vic]) {
      const b = member.browser;
      assert.equal((await b.patch(`/api/projects/${projectId}`, { name: 'Mine' })).status, 403);
      assert.equal((await b.get(`/api/projects/${projectId}/candidates`)).status, 403);
      assert.equal((await setMember(b, eve.id, 'project:admin')).status, 403);
      assert.equal((await b.delete(`/api/projects/${projectId}/members/${admin.id}`)).status, 403);
      assert.equal((await b.delete(`/api/projects/${projectId}`)).status, 403);
    }
  });

  it('never leaves a team project without an admin', async () => {
    assert.equal((await setMember(admin.browser, admin.id, 'project:viewer')).status, 409);
    assert.equal(
      (await admin.browser.delete(`/api/projects/${projectId}/members/${admin.id}`)).status,
      409
    );

    // With a second admin, the first can step down.
    assert.equal((await setMember(admin.browser, mia.id, 'project:admin')).status, 200);
    assert.equal(
      (await admin.browser.delete(`/api/projects/${projectId}/members/${admin.id}`)).status,
      204
    );
  });

  it('renames and deletes team projects, never personal ones', async () => {
    const rename = await mia.browser.patch(`/api/projects/${projectId}`, { name: 'Infra' });
    assert.equal(rename.status, 200);
    assert.equal((await mia.browser.get(`/api/projects/${projectId}`)).body.name, 'Infra');

    const personal = (await projectsOf(owner)).find((p) => p.type === 'personal');
    assert.equal((await owner.patch(`/api/projects/${personal?.id}`, { name: 'X' })).status, 400);
    assert.equal((await owner.delete(`/api/projects/${personal?.id}`)).status, 400);

    assert.equal((await mia.browser.delete(`/api/projects/${projectId}`)).status, 204);
    assert.equal((await mia.browser.get(`/api/projects/${projectId}`)).status, 404);
  });

  it('creates personal projects for accounts that predate projects', async () => {
    const client = new pg.Client({ connectionString: t.postgres.getConnectionUri() });
    await client.connect();
    try {
      await client.query(
        `insert into "user" (id, name, email, updated_at) values ('legacy-1', 'Leo', 'leo@example.com', now())`
      );
      const restarted = await createApp(t.config);
      await restarted.init();
      await restarted.close();
      const { rows } = await client.query(
        `select p.type from project p join project_relation r on r.project_id = p.id
         where r.user_id = 'legacy-1' and r.role = 'project:personalOwner'`
      );
      assert.deepEqual(rows, [{ type: 'personal' }]);
    } finally {
      await client.end();
    }
  });
});
