import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { ingestKey, project } from '../database/schema.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person } from '../test/people.js';
import { IngestKeysService } from './ingest-keys.service.js';
import type { CreatedIngestKey, IngestKeySummary } from './ingest-keys.service.js';

const KEY_PATTERN = /^ffi_[A-Za-z0-9_-]{43}$/;

describe('ingest keys against real Postgres', () => {
  let t: TestApp;
  let owner: Browser;
  let mia: Person; // team editor
  let vic: Person; // team viewer
  let eve: Person; // not in the team
  let shop: string;
  let created: CreatedIngestKey;

  beforeAll(async () => {
    t = await startTestApp();
    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    mia = await joinAs(t, owner, 'Mia');
    vic = await joinAs(t, owner, 'Vic');
    eve = await joinAs(t, owner, 'Eve');
    shop = (await owner.post('/api/projects', { name: 'Shop' })).body.id;
    await owner.put(`/api/projects/${shop}/members/${mia.id}`, { role: 'project:editor' });
    await owner.put(`/api/projects/${shop}/members/${vic.id}`, { role: 'project:viewer' });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a key shown once', async () => {
    const response = await mia.browser.post(`/api/projects/${shop}/ingest-keys`, { name: 'member-app' });
    assert.equal(response.status, 201);
    assert.equal(response.headers['cache-control'], 'no-store');
    created = response.body as CreatedIngestKey;
    assert.match(created.key, KEY_PATTERN);
    assert.equal(created.prefix, created.key.slice(0, 12));
    assert.equal(created.endpoint, 'http://fossflow.test/api/otlp');
  });

  it('setup blocks carry the key, endpoint and name', () => {
    assert.deepEqual(
      created.setup.map((block) => block.id),
      ['node-cjs', 'node-esm', 'nextjs']
    );
    for (const block of created.setup) {
      for (const step of block.steps.filter((s) => s.kind === 'env')) {
        const lines = step.code.split('\n');
        assert.ok(lines.includes('OTEL_SERVICE_NAME=member-app'));
        assert.ok(lines.includes('OTEL_EXPORTER_OTLP_ENDPOINT=http://fossflow.test/api/otlp'));
        assert.ok(lines.includes(`OTEL_EXPORTER_OTLP_HEADERS=x-fossflow-key=${created.key}`));
      }
    }
    const next = created.setup.find((block) => block.id === 'nextjs');
    assert.deepEqual(
      next?.steps.filter((s) => s.kind === 'file').map((s) => s.file),
      ['instrumentation.ts', 'instrumentation.node.ts']
    );
    const env = next?.steps.find((s) => s.kind === 'env');
    assert.ok(env?.code.split('\n').includes('NEXT_OTEL_FETCH_DISABLED=1'));
  });

  it('never returns the key again', async () => {
    const hash = createHash('sha256').update(created.key).digest('hex');
    for (const who of [owner, mia.browser, vic.browser]) {
      const response = await who.get(`/api/projects/${shop}/ingest-keys`);
      assert.equal(response.status, 200);
      const text = JSON.stringify(response.body);
      assert.ok(!text.includes(created.key));
      assert.ok(!text.includes(hash));
    }
    const [item] = (await owner.get(`/api/projects/${shop}/ingest-keys`)).body as IngestKeySummary[];
    assert.equal(item?.prefix, created.prefix);
    assert.equal(item?.createdBy, 'Mia');
    assert.equal(item?.lastUsedAt, null);
    assert.deepEqual(item?.services, []);
  });

  it('rejects names that would break the env block', async () => {
    for (const name of ['member app', 'a"b', '', 'a'.repeat(101)]) {
      const response = await mia.browser.post(`/api/projects/${shop}/ingest-keys`, { name });
      assert.equal(response.status, 400, JSON.stringify(name));
    }
  });

  it('authenticate resolves only live, well-formed keys', async () => {
    const keys = t.app.get(IngestKeysService);
    const ref = await keys.authenticate(created.key);
    assert.deepEqual(ref, { id: created.id, projectId: shop });
    assert.equal(await keys.authenticate(undefined), null);
    assert.equal(await keys.authenticate('ffi_short'), null);
    assert.equal(await keys.authenticate(`ffi_${'A'.repeat(43)}`), null);
  });

  describe('in-memory index', () => {
    const insertDirectly = async (projectId: string) => {
      const key = `ffi_${randomBytes(32).toString('base64url')}`;
      const id = randomUUID();
      await t.app.get<Database>(DB).insert(ingestKey).values({
        id,
        projectId,
        name: 'direct',
        keyHash: createHash('sha256').update(key).digest('hex'),
        prefix: key.slice(0, 12)
      });
      return { key, id };
    };

    it('accepts a created key immediately and rejects a deleted one immediately', async () => {
      const keys = t.app.get(IngestKeysService);
      const own: string = (await owner.post('/api/projects', { name: 'Fresh' })).body.id;
      const fresh: CreatedIngestKey = (await owner.post(`/api/projects/${own}/ingest-keys`, { name: 'fresh' })).body;
      assert.deepEqual(await keys.authenticate(fresh.key), { id: fresh.id, projectId: own });
      assert.equal((await owner.delete(`/api/ingest-keys/${fresh.id}`)).status, 204);
      assert.equal(await keys.authenticate(fresh.key), null);
    });

    it('runs no database query: a row inserted directly is unknown until reload', async () => {
      const keys = t.app.get(IngestKeysService);
      const own: string = (await owner.post('/api/projects', { name: 'Direct' })).body.id;
      const direct = await insertDirectly(own);
      assert.equal(await keys.authenticate(direct.key), null);
      await keys.reload();
      assert.deepEqual(await keys.authenticate(direct.key), { id: direct.id, projectId: own });
    });

    it('a project deleted directly stays accepted until reload', async () => {
      const keys = t.app.get(IngestKeysService);
      const doomed: string = (await owner.post('/api/projects', { name: 'Doomed' })).body.id;
      const key: CreatedIngestKey = (await owner.post(`/api/projects/${doomed}/ingest-keys`, { name: 'k' })).body;
      assert.ok(await keys.authenticate(key.key));
      await t.app.get<Database>(DB).delete(project).where(eq(project.id, doomed));
      assert.ok(await keys.authenticate(key.key));
      await keys.reload();
      assert.equal(await keys.authenticate(key.key), null);
    });
  });

  it('enforces roles, then deletes', async () => {
    const list = `/api/projects/${shop}/ingest-keys`;
    assert.equal((await vic.browser.get(list)).status, 200);
    assert.equal((await vic.browser.post(list, { name: 'x' })).status, 403);
    assert.equal((await vic.browser.delete(`/api/ingest-keys/${created.id}`)).status, 403);
    assert.equal((await eve.browser.get(list)).status, 404);
    assert.equal((await eve.browser.post(list, { name: 'x' })).status, 404);
    assert.equal((await eve.browser.delete(`/api/ingest-keys/${created.id}`)).status, 404);

    assert.equal((await mia.browser.delete(`/api/ingest-keys/${created.id}`)).status, 204);
    assert.deepEqual((await owner.get(list)).body, []);
    assert.equal(await t.app.get(IngestKeysService).authenticate(created.key), null);
  });

  it('allows at most 50 keys per project', async () => {
    const busy: string = (await owner.post('/api/projects', { name: 'Busy' })).body.id;
    const quiet: string = (await owner.post('/api/projects', { name: 'Quiet' })).body.id;
    // Inserted directly: 50 API calls would only test the same count query slowly.
    await t.app.get<Database>(DB).insert(ingestKey).values(
      Array.from({ length: 50 }, (_, i) => ({
        id: `bulk-${i}`,
        projectId: busy,
        name: `k${i}`,
        keyHash: `bulk-hash-${i}`,
        prefix: 'ffi_bulk'
      }))
    );

    const refused = await owner.post(`/api/projects/${busy}/ingest-keys`, { name: 'one-too-many' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'This project already has 50 ingest keys');
    assert.equal((await owner.post(`/api/projects/${quiet}/ingest-keys`, { name: 'fine' })).status, 201);
  });
});
