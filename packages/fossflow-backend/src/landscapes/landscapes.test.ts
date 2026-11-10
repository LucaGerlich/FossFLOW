import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from '../app.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person, personalOf } from '../test/people.js';

const builtIn = { id: 'server', name: 'Server', collection: 'isoflow', url: 'x' };
const imported = { id: 'mine', name: 'Mine', collection: 'imported', url: 'data:image/svg+xml,1' };
const model = (title: string) => ({
  title,
  icons: [builtIn, imported],
  colors: [{ id: 'blue', value: '#0070f3' }],
  items: [{ id: 'a', name: 'Web', icon: 'server' }],
  views: [{ id: 'v1', name: 'Main', items: [{ id: 'a', tile: { x: 0, y: 0 } }] }],
  fitToScreen: true
});

describe('landscapes against real Postgres', () => {
  let t: TestApp;
  let owner: Browser;
  let mia: Person;
  let vic: Person;
  let eve: Person;
  let team: string;
  let landscapeId: string;

  beforeAll(async () => {
    t = await startTestApp();

    // Old file-storage diagrams, imported once after first-run setup.
    const legacy = join(t.config.dataDir, 'diagrams');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'net.json'), JSON.stringify({ ...model('Network'), name: 'Network map', id: 'old-1' }));
    writeFileSync(join(legacy, 'broken.json'), '{ not json');

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
  });
  afterAll(async () => t?.close());

  it('imports old file-storage diagrams once, into the owner’s personal project', async () => {
    const personal = await personalOf(owner);
    const list = (await owner.get(`/api/projects/${personal}/landscapes`)).body as { name: string }[];
    assert.deepEqual(list.map((l) => l.name), ['Network map'], 'the broken file is skipped');

    const restarted = await createApp(t.config);
    await restarted.init();
    await restarted.close();
    const again = (await owner.get(`/api/projects/${personal}/landscapes`)).body as unknown[];
    assert.equal(again.length, 1, 'a restart imports nothing twice');
  });

  it('creates a landscape in a project, storing only imported icons', async () => {
    const created = await mia.browser.post(`/api/projects/${team}/landscapes`, {
      name: 'Web stack',
      model: model('ignored')
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.version, 1);
    landscapeId = created.body.id;

    const loaded = (await mia.browser.get(`/api/landscapes/${landscapeId}`)).body;
    assert.equal(loaded.name, 'Web stack');
    assert.equal(loaded.model.title, 'Web stack');
    assert.deepEqual(loaded.model.icons, [imported]);
    assert.equal(loaded.model.fitToScreen, undefined, 'unknown fields are dropped');
    assert.equal(loaded.projectName, 'Infrastructure');
    assert.ok(loaded.scopes.includes('landscape:update'));
  });

  it('rejects malformed and oversized models', async () => {
    const bad = await mia.browser.post(`/api/projects/${team}/landscapes`, {
      name: 'Bad',
      model: { items: 'nope' }
    });
    assert.equal(bad.status, 400);
    const huge = await mia.browser.post(`/api/projects/${team}/landscapes`, {
      name: 'Huge',
      model: { views: Array.from({ length: 201 }, () => ({})) }
    });
    assert.equal(huge.status, 400);
  });

  it('refuses positions the editor could not open again', async () => {
    const broken = model('Broken');
    broken.views[0] = { id: 'v1', name: 'Main', items: [{ id: 'a', tile: { x: null, y: 0 } as never }] };
    const res = await mia.browser.put(`/api/landscapes/${landscapeId}`, { model: broken, version: 1 });
    assert.equal(res.status, 400);
    assert.match(res.body.issues[0].path, /views\.0\.items\.0\.tile\.x/);
  });

  it('lists landscapes per project and in the overview', async () => {
    const inProject = (await vic.browser.get(`/api/projects/${team}/landscapes`)).body as {
      id: string;
      updatedByName: string;
    }[];
    assert.deepEqual(inProject.map((l) => l.id), [landscapeId]);
    assert.equal(inProject[0]?.updatedByName, 'Mia');

    const overview = (await owner.get('/api/landscapes')).body as { id: string }[];
    assert.ok(overview.some((l) => l.id === landscapeId));
    const eveOverview = (await eve.browser.get('/api/landscapes')).body as { id: string }[];
    assert.ok(!eveOverview.some((l) => l.id === landscapeId), 'non-members don’t see it');
  });

  it('saves on the current version and refuses stale saves with who saved last', async () => {
    const first = await mia.browser.put(`/api/landscapes/${landscapeId}`, {
      model: model('Web stack'),
      version: 1
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.version, 2);

    const stale = await owner.put(`/api/landscapes/${landscapeId}`, {
      model: model('Web stack'),
      version: 1
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentVersion, 2);
    assert.equal(stale.body.updatedByName, 'Mia');

    const overwrite = await owner.put(`/api/landscapes/${landscapeId}`, {
      model: model('Web stack'),
      version: stale.body.currentVersion
    });
    assert.equal(overwrite.body.version, 3);
  });

  it('keeps viewers read-only and outsiders out', async () => {
    assert.equal((await vic.browser.get(`/api/landscapes/${landscapeId}`)).status, 200);
    const save = await vic.browser.put(`/api/landscapes/${landscapeId}`, { model: model('x'), version: 3 });
    assert.equal(save.status, 403);
    assert.equal((await vic.browser.patch(`/api/landscapes/${landscapeId}`, { name: 'x' })).status, 403);
    assert.equal((await vic.browser.delete(`/api/landscapes/${landscapeId}`)).status, 403);
    assert.equal((await vic.browser.post(`/api/projects/${team}/landscapes`, { name: 'x' })).status, 403);

    assert.equal((await eve.browser.get(`/api/landscapes/${landscapeId}`)).status, 404);
    assert.equal((await eve.browser.get('/api/landscapes/does-not-exist')).status, 404);
  });

  it('renames, keeping the model title in step', async () => {
    assert.equal((await mia.browser.patch(`/api/landscapes/${landscapeId}`, { name: 'Web' })).status, 200);
    const loaded = (await mia.browser.get(`/api/landscapes/${landscapeId}`)).body;
    assert.equal(loaded.name, 'Web');
    assert.equal(loaded.model.title, 'Web');
    assert.equal(loaded.version, 4);
  });

  it('moves landscapes only with move rights and access to the target', async () => {
    const miaPersonal = await personalOf(mia.browser);
    const editorMove = await mia.browser.post(`/api/landscapes/${landscapeId}/move`, { projectId: miaPersonal });
    assert.equal(editorMove.status, 403, 'editors can’t move landscapes out');

    const hidden = await owner.post(`/api/landscapes/${landscapeId}/move`, { projectId: 'nope' });
    assert.equal(hidden.status, 404);

    const personal = await personalOf(owner);
    const moved = await owner.post(`/api/landscapes/${landscapeId}/move`, { projectId: personal });
    assert.equal(moved.status, 200);
    assert.equal((await mia.browser.get(`/api/landscapes/${landscapeId}`)).status, 404);
    assert.equal((await owner.get(`/api/landscapes/${landscapeId}`)).body.projectId, personal);
  });

  it('transfers or deletes landscapes when their project is deleted', async () => {
    const ops = (await owner.post('/api/projects', { name: 'Ops' })).body.id;
    const keep = (await owner.post(`/api/projects/${ops}/landscapes`, { name: 'Keep me' })).body.id;
    const archive = (await owner.post('/api/projects', { name: 'Archive' })).body.id;

    const refused = await owner.delete(`/api/projects/${ops}?transferTo=${ops}`);
    assert.equal(refused.status, 400);
    assert.equal((await owner.delete(`/api/projects/${ops}?transferTo=${archive}`)).status, 204);
    assert.equal((await owner.get(`/api/landscapes/${keep}`)).body.projectId, archive);

    assert.equal((await owner.delete(`/api/projects/${archive}`)).status, 204);
    assert.equal((await owner.get(`/api/landscapes/${keep}`)).status, 404, 'deleted with its project');
  });

  it('deletes a landscape for editors', async () => {
    const draft = (await mia.browser.post(`/api/projects/${team}/landscapes`, { name: 'Draft' })).body.id;
    assert.equal((await mia.browser.delete(`/api/landscapes/${draft}`)).status, 204);
    assert.equal((await mia.browser.get(`/api/landscapes/${draft}`)).status, 404);
  });
});

describe('old file storage moved in after setup', () => {
  it('imports it on the first start that finds the folder', async () => {
    const t = await startTestApp();
    try {
      const owner = t.browser();
      await owner.post('/api/setup/owner', {
        name: 'Olivia',
        email: 'owner@example.com',
        password: 'Owner-pass-1'
      });
      const legacy = join(t.config.dataDir, 'diagrams');
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, 'late.json'), JSON.stringify({ ...model('Late'), name: 'Moved in later' }));

      const restarted = await createApp(t.config);
      await restarted.init();
      await restarted.close();

      const personal = await personalOf(owner);
      const list = (await owner.get(`/api/projects/${personal}/landscapes`)).body as { name: string }[];
      assert.deepEqual(list.map((l) => l.name), ['Moved in later']);
    } finally {
      await t.close();
    }
  });
});
