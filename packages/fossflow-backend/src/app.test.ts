import assert from 'node:assert/strict';
import pg from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from './app.js';
import { startTestApp, type TestApp } from './test/app.js';

describe('app against real Postgres', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => t?.close());

  it('reports healthy once migrations have run', async () => {
    const response = await t.browser().get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  });

  it('applied the migrations on startup', async () => {
    const client = new pg.Client({ connectionString: t.postgres.getConnectionUri() });
    await client.connect();
    try {
      const { rows } = await client.query<{ name: string }>(
        "select table_name as name from information_schema.tables where table_schema = 'public'"
      );
      const tables = rows.map((row) => row.name);
      for (const table of ['meta', 'user', 'session', 'account', 'verification', 'invitation']) {
        assert.ok(tables.includes(table), `missing table ${table}`);
      }
    } finally {
      await client.end();
    }
  });

  it('starts a second time without re-running migrations', async () => {
    const second = await createApp(t.config);
    await second.init();
    await second.close();
  });

  it('keeps live data behind sign-in', async () => {
    const response = await t.browser().get('/api/landscapes/any/live');
    assert.equal(response.status, 401);
  });
});
