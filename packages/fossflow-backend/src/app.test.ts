import assert from 'node:assert/strict';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';
import { startPostgres } from './test/postgres.js';

describe('app against real Postgres', () => {
  let postgres: StartedPostgreSqlContainer;
  let app: NestExpressApplication;

  beforeAll(async () => {
    postgres = await startPostgres();
    app = await createApp(
      loadConfig({ DATABASE_URL: postgres.getConnectionUri() })
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  it('reports healthy once migrations have run', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  });

  it('applied the migrations on startup', async () => {
    const client = new pg.Client({ connectionString: postgres.getConnectionUri() });
    await client.connect();
    try {
      const { rows } = await client.query<{ name: string }>(
        "select table_name as name from information_schema.tables where table_schema = 'public'"
      );
      assert.ok(rows.some((row) => row.name === 'meta'));
    } finally {
      await client.end();
    }
  });

  it('starts a second time without re-running migrations', async () => {
    const second = await createApp(
      loadConfig({ DATABASE_URL: postgres.getConnectionUri() })
    );
    await second.init();
    const response = await request(second.getHttpServer()).get('/api/health');
    assert.equal(response.status, 200);
    await second.close();
  });

  it('keeps the live routes working with no source configured', async () => {
    const response = await request(app.getHttpServer()).get('/api/live/status');
    assert.deepEqual(response.body, { enabled: false, sources: [] });
  });
});
