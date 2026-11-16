import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { project, trafficAlias } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { unambiguousAliases } from './aliases.js';

const NOW = new Date(Date.UTC(2026, 10, 13, 10, 0));
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);

describe('unambiguous aliases', () => {
  let t: TestApp;
  let db: Database;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    await db.insert(project).values({ id: 'alias-project', name: 'P', type: 'team' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('keeps hosts claimed by one service in 24 h and drops shared or stale ones', async () => {
    const claim = (host: string, service: string, lastSeenAt: Date) => ({
      projectId: 'alias-project',
      host,
      service,
      lastSeenAt
    });
    await db.insert(trafficAlias).values([
      claim('orders.internal', 'orders', hoursAgo(1)),
      claim('shared.internal', 'orders', hoursAgo(1)),
      claim('shared.internal', 'billing', hoursAgo(2)),
      claim('stale.internal', 'orders', hoursAgo(25)),
      claim('mixed.internal', 'orders', hoursAgo(1)),
      claim('mixed.internal', 'billing', hoursAgo(30)) // too old to make it ambiguous
    ]);
    const aliases = await unambiguousAliases(db, 'alias-project', NOW);
    assert.deepEqual(
      aliases.map(({ host, service }) => `${host}=${service}`).sort(),
      ['mixed.internal=orders', 'orders.internal=orders']
    );
  });
});
