import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import { startTestApp, type TestApp } from '../test/app.js';

describe('traffic SQL helpers', () => {
  let t: TestApp;
  let db: Database;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
  });
  afterAll(async () => {
    await t.close();
  });

  const one = async (query: ReturnType<typeof sql>): Promise<unknown> => {
    const result = await db.execute<{ v: number[] | null }>(query);
    return result.rows[0]?.v;
  };

  it('adds arrays element by element', async () => {
    assert.deepEqual(await one(sql`select int_array_add('{1,2,3}', '{10,0,1}') as v`), [11, 2, 4]);
  });

  it('treats a NULL array as empty', async () => {
    assert.deepEqual(await one(sql`select int_array_add(NULL, '{1,2}') as v`), [1, 2]);
  });

  it('sums arrays as an aggregate', async () => {
    assert.deepEqual(
      await one(sql`select int_array_sum(h) as v from (values ('{1,0}'::int[]), ('{2,5}')) t(h)`),
      [3, 5]
    );
  });
});
