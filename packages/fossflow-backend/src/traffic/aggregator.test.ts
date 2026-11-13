import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import type { IngestKeyRef } from '../ingest/ingest-keys.service.js';
import type { TrafficBatch, TrafficEvent } from '../ingest/spans.js';
import { DB, type Database } from '../database/database.module.js';
import { ingestKey, ingestService, project, trafficAlias, trafficFailure, trafficMinute } from '../database/schema.js';
import { startTestApp, type TestApp } from '../test/app.js';
import { TrafficAggregator } from './aggregator.js';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 13, 12, 0, 30);

const call = (overrides: Partial<TrafficEvent> = {}): TrafficEvent => ({
  kind: 'call',
  caller: 'service:web',
  callee: 'service:api',
  operation: 'GET /orders',
  at: NOW,
  durationMs: 120,
  failed: false,
  status: null,
  ...overrides
});

const batch = (events: TrafficEvent[], extra: Partial<TrafficBatch> = {}): TrafficBatch => ({
  events,
  services: [],
  aliases: [],
  ...extra
});

describe('traffic aggregator against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let aggregator: TrafficAggregator;

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    aggregator = t.app.get(TrafficAggregator);
  });
  afterAll(async () => {
    await t?.close();
  });

  /** A fresh project with one ingest key, so tests don't share rows or caps. */
  const newKey = async (): Promise<IngestKeyRef> => {
    const projectId = randomUUID();
    const id = randomUUID();
    await db.insert(project).values({ id: projectId, name: 'P', type: 'team' });
    await db.insert(ingestKey).values({ id, projectId, name: 'k', keyHash: randomUUID(), prefix: 'ffi_x' });
    return { id, projectId };
  };

  const minutesOf = (projectId: string) => db.select().from(trafficMinute).where(eq(trafficMinute.projectId, projectId));

  const failuresOf = (projectId: string) =>
    db.select().from(trafficFailure).where(eq(trafficFailure.projectId, projectId));

  it('stores a minute', async () => {
    const key = await newKey();
    aggregator.add(key, batch([call(), call({ durationMs: 480, failed: true, status: '503' })]), NOW);
    await aggregator.flush(NOW);

    const rows = await minutesOf(key.projectId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.calls, 2);
    assert.equal(rows[0]?.failures, 1);
    assert.equal(rows[0]?.durationSumMs, 600);
    assert.equal(rows[0]?.minute.getTime(), Math.floor(NOW / MINUTE) * MINUTE);
    const histogram = rows[0]?.histogram ?? [];
    assert.equal(histogram.length, 22);
    assert.equal(histogram[7], 1);
    assert.equal(histogram[10], 1);
    assert.equal(histogram.reduce((a, b) => a + b, 0), 2);

    const failures = await failuresOf(key.projectId);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.status, '503');
    assert.equal(failures[0]?.durationMs, 480);
  });

  it('adds to an existing minute', async () => {
    const key = await newKey();
    const events = [call(), call({ durationMs: 480, failed: true, status: '503' })];
    aggregator.add(key, batch(events), NOW);
    await aggregator.flush(NOW);
    aggregator.add(key, batch(events), NOW);
    await aggregator.flush(NOW);

    const rows = await minutesOf(key.projectId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.calls, 4);
    assert.equal(rows[0]?.failures, 2);
    assert.equal(rows[0]?.durationSumMs, 1200);
    assert.equal(rows[0]?.histogram[7], 2);
    assert.equal(rows[0]?.histogram[10], 2);
  });

  it('writes services, aliases and lastUsedAt', async () => {
    const key = await newKey();
    aggregator.add(
      key,
      batch([call()], {
        services: ['member-app'],
        aliases: [{ host: 'member-app.internal', service: 'member-app' }]
      }),
      NOW
    );
    await aggregator.flush(NOW);

    const services = await db.select().from(ingestService).where(eq(ingestService.keyId, key.id));
    assert.deepEqual(
      services.map((row) => row.serviceName),
      ['member-app']
    );
    const aliases = await db.select().from(trafficAlias).where(eq(trafficAlias.projectId, key.projectId));
    assert.deepEqual(
      aliases.map((row) => [row.host, row.service]),
      [['member-app.internal', 'member-app']]
    );
    const [row] = await db.select().from(ingestKey).where(eq(ingestKey.id, key.id));
    assert.equal(row?.lastUsedAt?.getTime(), NOW);
  });

  it('caps operations per pair and pairs per project', async () => {
    const key = await newKey();
    const operations = Array.from({ length: 205 }, (_, i) => call({ operation: `op-${i}` }));
    aggregator.add(key, batch(operations), NOW);
    await aggregator.flush(NOW);

    const rows = await minutesOf(key.projectId);
    assert.equal(rows.length, 201);
    assert.equal(rows.find((row) => row.operation === 'other')?.calls, 5);
    assert.equal(rows.filter((row) => row.operation !== 'other').length, 200);

    const wide = await newKey();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const pairs = Array.from({ length: 1005 }, (_, i) => call({ callee: `service:svc-${i}` }));
      aggregator.add(wide, batch(pairs), NOW);
      aggregator.add(wide, batch([call({ callee: 'service:svc-extra' })]), NOW);
      await aggregator.flush(NOW);
      assert.equal(warn.mock.calls.filter(([message]) => String(message).includes(wide.projectId)).length, 1);
    } finally {
      warn.mockRestore();
    }
    assert.equal((await minutesOf(wide.projectId)).length, 1000);
  });

  it('caps buffered failures per arrow but still counts every call', async () => {
    const key = await newKey();
    const failed = Array.from({ length: 150 }, () => call({ failed: true, status: '500' }));
    aggregator.add(key, batch(failed), NOW);
    await aggregator.flush(NOW);

    assert.equal((await failuresOf(key.projectId)).length, 100);
    const [row] = await minutesOf(key.projectId);
    assert.equal(row?.calls, 150);
    assert.equal(row?.failures, 150);
  });

  it("a deleted project doesn't poison the flush", async () => {
    const a = await newKey();
    const b = await newKey();
    aggregator.add(a, batch([call()], { services: ['svc'] }), NOW);
    aggregator.add(b, batch([call()]), NOW);
    await db.delete(project).where(eq(project.id, a.projectId));

    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await aggregator.flush(NOW);
      assert.ok(warn.mock.calls.some(([message]) => String(message).includes(a.projectId)));
    } finally {
      warn.mockRestore();
    }
    assert.equal((await minutesOf(b.projectId)).length, 1);
    assert.equal((await minutesOf(a.projectId)).length, 0);
    const [row] = await db
      .select()
      .from(ingestKey)
      .where(and(eq(ingestKey.id, b.id)));
    assert.ok(row?.lastUsedAt);
  });
});
