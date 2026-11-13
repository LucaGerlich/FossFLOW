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
import { MAX_MINUTE_BUCKETS_PER_FLUSH, TrafficAggregator } from './aggregator.js';

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

  it('keeps the valid rows of a flush when one row cannot be stored', async () => {
    const key = await newKey();
    const bad = call({ operation: `bad\u0000${'\u{1F600}'.repeat(300)}` });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      aggregator.add(key, batch([call(), bad]), NOW);
      await aggregator.flush(NOW);
      const rows = await minutesOf(key.projectId);
      assert.deepEqual(
        rows.map((row) => row.operation),
        ['GET /orders']
      );
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(key.projectId));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), /traffic_minute/);
      assert.match(String(mine[0]?.[0]), /SQLSTATE 22021/);
      assert.doesNotMatch(String(mine[0]?.[0]), /bad|\u{1F600}/u);
    } finally {
      warn.mockRestore();
    }
  });

  it('recovers when a flush throws outside its guards', async () => {
    const key = await newKey();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const internals = aggregator as unknown as { write: (now: number) => Promise<void> };
    const write = vi.spyOn(internals, 'write').mockRejectedValueOnce(new Error('secret row value'));
    try {
      aggregator.add(key, batch([call()]), NOW);
      await aggregator.flush(NOW);
      assert.ok(warn.mock.calls.length > 0);
      assert.ok(warn.mock.calls.every(([message]) => !String(message).includes('secret row value')));

      aggregator.add(key, batch([call()]), NOW);
      await aggregator.flush(NOW);
      // The mocked write never took the first call's buffer, so both are stored now.
      assert.equal((await minutesOf(key.projectId))[0]?.calls, 2);
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
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

  it('keeps at most 100 services per key and warns once', async () => {
    const key = await newKey();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const services = Array.from({ length: 105 }, (_, i) => `svc-${i}`);
      aggregator.add(key, batch([call()], { services }), NOW);
      aggregator.add(key, batch([call()], { services }), NOW);
      await aggregator.flush(NOW);
      assert.equal(warn.mock.calls.filter(([message]) => String(message).includes(key.id)).length, 1);
    } finally {
      warn.mockRestore();
    }
    const rows = await db.select().from(ingestService).where(eq(ingestService.keyId, key.id));
    assert.equal(rows.length, 100);
  });

  it('keeps at most 500 aliases per project', async () => {
    const key = await newKey();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const aliases = Array.from({ length: 505 }, (_, i) => ({ host: `host-${i}`, service: 'svc' }));
      aggregator.add(key, batch([call()], { aliases }), NOW);
      await aggregator.flush(NOW);
      assert.equal(warn.mock.calls.filter(([message]) => String(message).includes(key.projectId)).length, 1);
    } finally {
      warn.mockRestore();
    }
    const rows = await db.select().from(trafficAlias).where(eq(trafficAlias.projectId, key.projectId));
    assert.equal(rows.length, 500);
  });

  it('retries identity writes that failed, even within the minute', async () => {
    const key = await newKey();
    await db.delete(project).where(eq(project.id, key.projectId));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      aggregator.add(key, batch([], { services: ['member-app'] }), NOW);
      await aggregator.flush(NOW);
      assert.ok(warn.mock.calls.length > 0);
    } finally {
      warn.mockRestore();
    }
    await db.insert(project).values({ id: key.projectId, name: 'P', type: 'team' });
    await db.insert(ingestKey).values({ id: key.id, projectId: key.projectId, name: 'k', keyHash: randomUUID(), prefix: 'ffi_x' });

    aggregator.add(key, batch([], { services: ['member-app'] }), NOW + 1000);
    await aggregator.flush(NOW + 1000);
    const rows = await db.select().from(ingestService).where(eq(ingestService.keyId, key.id));
    assert.deepEqual(rows.map((row) => row.serviceName), ['member-app']);
    const [row] = await db.select().from(ingestKey).where(eq(ingestKey.id, key.id));
    assert.ok(row?.lastUsedAt);
  });

  it("one failing key doesn't drop the other keys of a project", async () => {
    const good = await newKey();
    const bad: IngestKeyRef = { id: randomUUID(), projectId: good.projectId };
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      aggregator.add(bad, batch([], { services: ['ghost'] }), NOW);
      aggregator.add(good, batch([], { services: ['real'] }), NOW);
      await aggregator.flush(NOW);
    } finally {
      warn.mockRestore();
    }
    const rows = await db.select().from(ingestService).where(eq(ingestService.keyId, good.id));
    assert.equal(rows.length, 1);
    const [row] = await db.select().from(ingestKey).where(eq(ingestKey.id, good.id));
    assert.ok(row?.lastUsedAt);
  });

  it('prunes throttle entries older than a minute on flush', async () => {
    const key = await newKey();
    aggregator.add(key, batch([call()], { services: ['svc'], aliases: [{ host: 'h', service: 'svc' }] }), NOW);
    await aggregator.flush(NOW);
    assert.ok(aggregator.throttleSize >= 3);
    await aggregator.flush(NOW + 2 * MINUTE);
    assert.equal(aggregator.throttleSize, 0);
  });

  it('admits new services and pairs again after the 24 h reset', async () => {
    const key = await newKey();
    const later = NOW + 25 * 3_600_000;
    const services = Array.from({ length: 105 }, (_, i) => `svc-${i}`);
    const pairs = Array.from({ length: 1005 }, (_, i) => call({ callee: `service:svc-${i}`, at: later }));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      aggregator.add(key, batch(pairs.map((e) => ({ ...e, at: NOW })), { services }), NOW);
      await aggregator.flush(NOW);
      aggregator.add(key, batch(pairs.slice(1000), { services: services.slice(100) }), later);
      await aggregator.flush(later);
    } finally {
      warn.mockRestore();
    }
    const rows = await db.select().from(ingestService).where(eq(ingestService.keyId, key.id));
    assert.equal(rows.length, 105);
    assert.equal((await minutesOf(key.projectId)).length, 1005);
  });

  it('caps minute buckets per project per flush window', async () => {
    const key = await newKey();
    const total = MAX_MINUTE_BUCKETS_PER_FLUSH + 5000;
    // 3 pairs x 200 operations x 60 minutes gives 36 000 distinct buckets.
    const events = Array.from({ length: total }, (_, i) =>
      call({
        callee: `service:svc-${i % 3}`,
        operation: `op-${Math.floor(i / 3) % 200}`,
        at: NOW - Math.floor(i / 600) * MINUTE
      })
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      aggregator.add(key, batch(events), NOW);
      // Events for buckets that already exist still count.
      aggregator.add(key, batch([events[0] as TrafficEvent]), NOW);
      await aggregator.flush(NOW);
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(key.projectId));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), /dropped 5000 /);
    } finally {
      warn.mockRestore();
    }
    assert.equal((await minutesOf(key.projectId)).length, MAX_MINUTE_BUCKETS_PER_FLUSH);

    aggregator.add(key, batch([call({ operation: 'fresh' })]), NOW);
    await aggregator.flush(NOW);
    assert.equal((await minutesOf(key.projectId)).length, MAX_MINUTE_BUCKETS_PER_FLUSH + 1);
  });

  /** A second ingest key in the same project as `other`. */
  const siblingKey = async (other: IngestKeyRef): Promise<IngestKeyRef> => {
    const id = randomUUID();
    await db.insert(ingestKey).values({ id, projectId: other.projectId, name: 'k2', keyHash: randomUUID(), prefix: 'ffi_y' });
    return { id, projectId: other.projectId };
  };

  const quiet = async (run: (warn: { mock: { calls: unknown[][] } }) => Promise<void>): Promise<void> => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await run(warn);
    } finally {
      warn.mockRestore();
    }
  };

  it("one key's full pair budget doesn't block another key of the project", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    await quiet(async () => {
      aggregator.add(a, batch(Array.from({ length: 1005 }, (_, i) => call({ callee: `service:svc-${i}` }))), NOW);
      aggregator.add(b, batch([call({ callee: 'service:only-b' })]), NOW);
      await aggregator.flush(NOW);
    });
    const rows = await minutesOf(a.projectId);
    assert.equal(rows.length, 1001);
    assert.ok(rows.some((row) => row.callee === 'service:only-b'));
  });

  it("one key's full alias budget doesn't block another key of the project", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    await quiet(async () => {
      const aliases = Array.from({ length: 505 }, (_, i) => ({ host: `host-${i}`, service: 'svc' }));
      aggregator.add(a, batch([], { aliases }), NOW);
      aggregator.add(b, batch([], { aliases: [{ host: 'only-b', service: 'svc' }] }), NOW);
      await aggregator.flush(NOW);
    });
    const rows = await db.select().from(trafficAlias).where(eq(trafficAlias.projectId, a.projectId));
    assert.equal(rows.length, 501);
    assert.ok(rows.some((row) => row.host === 'only-b'));
  });

  it("one key's full bucket budget doesn't block another key, and warns once per key", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    const overflow = () =>
      Array.from({ length: MAX_MINUTE_BUCKETS_PER_FLUSH + 5000 }, (_, i) =>
        call({
          callee: `service:svc-${i % 3}`,
          operation: `op-${Math.floor(i / 3) % 200}`,
          at: NOW - Math.floor(i / 600) * MINUTE
        })
      );
    await quiet(async (warn) => {
      aggregator.add(a, batch(overflow()), NOW);
      aggregator.add(b, batch([call({ operation: 'only-b' })]), NOW);
      await aggregator.flush(NOW);
      // A second overflowing window for the same key stays quiet.
      aggregator.add(a, batch(overflow()), NOW);
      await aggregator.flush(NOW);
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(a.id));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), new RegExp(a.projectId));
    });
    const rows = await minutesOf(a.projectId);
    assert.equal(rows.length, MAX_MINUTE_BUCKETS_PER_FLUSH + 1);
    assert.ok(rows.some((row) => row.operation === 'only-b'));
  });

  it("a project's ceiling bounds pairs across its keys, and known pairs still count", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    const c = await siblingKey(a);
    await quiet(async (warn) => {
      const pairs = (from: number, to: number) =>
        Array.from({ length: to - from }, (_, i) => call({ callee: `service:svc-${from + i}` }));
      aggregator.add(a, batch(pairs(0, 1000)), NOW);
      aggregator.add(b, batch(pairs(1000, 2000)), NOW);
      aggregator.add(c, batch(pairs(2000, 2001)), NOW);
      aggregator.add(b, batch(pairs(0, 1)), NOW);
      aggregator.add(a, batch(pairs(1000, 1001)), NOW);
      await aggregator.flush(NOW);
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(a.projectId));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), /^Project /);
    });
    const rows = await minutesOf(a.projectId);
    assert.equal(rows.length, 2000);
    assert.equal(rows.find((row) => row.callee === 'service:svc-0')?.calls, 2);
    assert.equal(rows.find((row) => row.callee === 'service:svc-1000')?.calls, 2);
    assert.ok(!rows.some((row) => row.callee === 'service:svc-2000'));
  });

  it("a project's ceiling bounds aliases across its keys", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    const c = await siblingKey(a);
    await quiet(async (warn) => {
      const aliases = (from: number, to: number) =>
        Array.from({ length: to - from }, (_, i) => ({ host: `host-${from + i}`, service: 'svc' }));
      aggregator.add(a, batch([], { aliases: aliases(0, 500) }), NOW);
      aggregator.add(b, batch([], { aliases: aliases(500, 1000) }), NOW);
      aggregator.add(c, batch([], { aliases: aliases(1000, 1002) }), NOW);
      await aggregator.flush(NOW);
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(a.projectId));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), /^Project /);
    });
    const rows = await db.select().from(trafficAlias).where(eq(trafficAlias.projectId, a.projectId));
    assert.equal(rows.length, 1000);
  });

  it("a project's ceiling bounds minute buckets per flush window", async () => {
    const a = await newKey();
    const b = await siblingKey(a);
    const c = await siblingKey(a);
    const buckets = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) =>
        call({
          callee: `service:svc-${(from + i) % 3}`,
          operation: `op-${Math.floor((from + i) / 3) % 200}`,
          at: NOW - Math.floor((from + i) / 600) * MINUTE
        })
      );
    await quiet(async (warn) => {
      aggregator.add(a, batch(buckets(0, 20_000)), NOW);
      aggregator.add(b, batch(buckets(20_000, 40_000)), NOW);
      aggregator.add(c, batch([call({ operation: 'one-more' })]), NOW);
      // A bucket that exists already still counts.
      aggregator.add(b, batch(buckets(0, 1)), NOW);
      await aggregator.flush(NOW);
      const mine = warn.mock.calls.filter(([message]) => String(message).includes(a.projectId));
      assert.equal(mine.length, 1);
      assert.match(String(mine[0]?.[0]), /^Project /);
    });
    const rows = await minutesOf(a.projectId);
    assert.equal(rows.length, 40_000);
    assert.ok(!rows.some((row) => row.operation === 'one-more'));
    assert.equal(rows.find((row) => row.operation === 'op-0' && row.callee === 'service:svc-0' && row.minute.getTime() === Math.floor(NOW / MINUTE) * MINUTE)?.calls, 2);
  });
});
