import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { OTLPTraceExporter as JsonExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as ProtoExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { DB, type Database } from '../database/database.module.js';
import {
  ingestKey,
  ingestService,
  trafficAlias,
  trafficFailure,
  trafficHour,
  trafficMinute
} from '../database/schema.js';
import { TrafficAggregator } from '../traffic/aggregator.js';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person } from '../test/people.js';
import type { CreatedIngestKey } from './ingest-keys.service.js';

const MIB = 1024 * 1024;

describe('OTLP endpoint against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let owner: Browser;
  let mia: Person;
  let shop: string;
  let other: string;
  let shopKey: CreatedIngestKey;
  let otherKey: CreatedIngestKey;
  let origin: string;
  const http = () => request(origin);

  const createKey = async (
    who: Browser,
    project: string,
    name: string
  ): Promise<CreatedIngestKey> => {
    const response = await who.post(`/api/projects/${project}/ingest-keys`, { name });
    assert.equal(response.status, 201);
    return response.body as CreatedIngestKey;
  };

  /** The exporter URL and header, read from the key's node-cjs setup step. */
  const connection = (key: CreatedIngestKey) => {
    const env = key.setup
      .find((block) => block.id === 'node-cjs')
      ?.steps.find((step) => step.kind === 'env');
    assert.ok(env);
    const lines = env.code.split('\n');
    const endpoint = lines
      .find((line) => line.startsWith('OTEL_EXPORTER_OTLP_ENDPOINT='))
      ?.split('=')[1];
    const header = lines
      .find((line) => line.startsWith('OTEL_EXPORTER_OTLP_HEADERS='))
      ?.slice('OTEL_EXPORTER_OTLP_HEADERS='.length);
    assert.ok(endpoint && header);
    const [name, value] = header.split('=') as [string, string];
    return {
      url: `${endpoint.replace('http://fossflow.test', origin)}/v1/traces`,
      headers: { [name]: value }
    };
  };

  const send = async (
    key: CreatedIngestKey,
    serviceName: string,
    format: 'proto' | 'json',
    emit: (tracer: ReturnType<TracerProvider['getTracer']>, t0: number) => void
  ): Promise<void> => {
    const { url, headers } = connection(key);
    const exporter =
      format === 'proto'
        ? new ProtoExporter({ url, headers, compression: CompressionAlgorithm.GZIP })
        : new JsonExporter({ url, headers });
    const provider = new TracerProvider({
      resource: resourceFromAttributes({ 'service.name': serviceName }),
      spanProcessors: [new SimpleSpanProcessor({ exporter })]
    });
    // Spans of one send land in the same minute bucket.
    const wait = 60_000 - (Date.now() % 60_000);
    if (wait < 5000) await new Promise((resolve) => setTimeout(resolve, wait + 50));
    emit(provider.getTracer('test'), Date.now() - 1000);
    await provider.forceFlush(); // rejects when an export failed
    await provider.shutdown();
    await t.app.get(TrafficAggregator).flush();
  };

  const emitShapes = (tracer: ReturnType<TracerProvider['getTracer']>, t0: number): void => {
    const get = tracer.startSpan('GET', {
      kind: SpanKind.CLIENT,
      startTime: t0,
      attributes: {
        'http.request.method': 'GET',
        'url.full': 'https://api.magicline.com/v1/customers/12345?email=jane@example.com',
        'server.address': 'api.magicline.com',
        'http.response.status_code': 200
      }
    });
    get.end(t0 + 120);
    const post = tracer.startSpan('POST', {
      kind: SpanKind.CLIENT,
      startTime: t0,
      attributes: {
        'http.request.method': 'POST',
        'url.full': 'https://api.magicline.com/v1/checkins',
        'server.address': 'api.magicline.com',
        'http.response.status_code': 503
      }
    });
    post.setStatus({ code: SpanStatusCode.ERROR });
    post.end(t0 + 80);
    const query = tracer.startSpan('SELECT', {
      kind: SpanKind.CLIENT,
      startTime: t0,
      attributes: {
        'db.system.name': 'postgresql',
        'server.address': 'members.db.internal',
        'db.namespace': 'members',
        'db.operation.name': 'SELECT',
        'db.collection.name': 'members',
        'db.query.text': "SELECT * FROM members WHERE email='jane@example.com'"
      }
    });
    query.end(t0 + 5);
    const server = tracer.startSpan('GET /checkin', {
      kind: SpanKind.SERVER,
      startTime: t0,
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/checkin',
        'server.address': 'member-app.internal'
      }
    });
    server.end(t0 + 30);
    tracer.startSpan('work', { kind: SpanKind.INTERNAL, startTime: t0 }).end(t0 + 2);
  };

  const minutesOf = (projectId: string) =>
    db
      .select()
      .from(trafficMinute)
      .then((rows) => rows.filter((row) => row.projectId === projectId));

  beforeAll(async () => {
    t = await startTestApp();
    await t.app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
    db = t.app.get<Database>(DB);
    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    mia = await joinAs(t, owner, 'Mia');
    shop = (await owner.post('/api/projects', { name: 'Shop' })).body.id;
    other = (await owner.post('/api/projects', { name: 'Other' })).body.id;
    await owner.put(`/api/projects/${shop}/members/${mia.id}`, { role: 'project:editor' });
    shopKey = await createKey(mia.browser, shop, 'member-app');
    otherKey = await createKey(owner, other, 'other-app');
  });
  afterAll(async () => {
    await t?.close();
  });

  it('protobuf with gzip, end to end', async () => {
    await send(shopKey, 'member-app', 'proto', emitShapes);
    const rows = await minutesOf(shop);
    const shapes = rows
      .map((row) => `${row.kind} ${row.caller} > ${row.callee} ${row.operation}`)
      .sort();
    assert.deepEqual(shapes, [
      'call service:member-app > db:members.db.internal/members SELECT members',
      'call service:member-app > host:api.magicline.com GET /v1/customers/{id}',
      'call service:member-app > host:api.magicline.com POST /v1/checkins',
      'incoming  > service:member-app GET /checkin'
    ]);
    const failures = (await db.select().from(trafficFailure)).filter((row) => row.projectId === shop);
    assert.deepEqual(failures.map((row) => row.status), ['503']);
    const services = await db.select().from(ingestService);
    assert.ok(services.some((row) => row.serviceName === 'member-app'));
    assert.ok((await db.select().from(trafficAlias)).some((row) => row.projectId === shop));
    const [key] = (await db.select().from(ingestKey)).filter((row) => row.id === shopKey.id);
    assert.ok(key?.lastUsedAt);
  });

  it('JSON with old attribute names', async () => {
    await send(shopKey, 'sync-service', 'json', (tracer, t0) => {
      const get = tracer.startSpan('GET', {
        kind: SpanKind.CLIENT,
        startTime: t0,
        attributes: {
          'http.method': 'GET',
          'http.url': 'https://api.magicline.com/v1/customers/12345?email=jane@example.com',
          'net.peer.name': 'api.magicline.com'
        }
      });
      get.end(t0 + 90);
    });
    const rows = await minutesOf(shop);
    const row = rows.find((r) => r.caller === 'service:sync-service');
    assert.equal(row?.callee, 'host:api.magicline.com');
    assert.equal(row?.operation, 'GET /v1/customers/{id}');
  });

  it('stores nothing personal', async () => {
    const [minutes, hours, failures, aliases, services, keys] = await Promise.all([
      db.select().from(trafficMinute),
      db.select().from(trafficHour),
      db.select().from(trafficFailure),
      db.select().from(trafficAlias),
      db.select().from(ingestService),
      db.select().from(ingestKey)
    ]);
    const texts = [
      ...[...minutes, ...hours].flatMap((r) => [r.caller, r.callee, r.operation]),
      ...failures.flatMap((r) => [r.caller, r.callee, r.operation, r.status]),
      ...aliases.flatMap((r) => [r.host, r.service]),
      ...services.map((r) => r.serviceName),
      ...keys.flatMap((r) => [r.name, r.prefix])
    ];
    assert.ok(texts.length > 0);
    for (const text of texts) {
      assert.doesNotMatch(text, /jane|12345|email=|WHERE/);
    }
    for (const row of keys) {
      for (const value of [row.id, row.projectId, row.name, row.keyHash, row.prefix]) {
        assert.ok(!value.includes(shopKey.key) && !value.includes(otherKey.key));
      }
    }
  });

  it('keeps projects apart', async () => {
    await send(otherKey, 'other-app', 'json', (tracer, t0) => {
      tracer
        .startSpan('GET', {
          kind: SpanKind.CLIENT,
          startTime: t0,
          attributes: { 'http.request.method': 'GET', 'url.full': 'https://other.example/v1/x' }
        })
        .end(t0 + 10);
    });
    const rows = await minutesOf(other);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.caller === 'service:other-app'));
    assert.ok(!(await minutesOf(shop)).some((row) => row.caller === 'service:other-app'));
  });

  describe('HTTP answers', () => {
    const post = (key: string | undefined, type: string | undefined, body: Buffer | string) => {
      let req = http().post('/api/otlp/v1/traces');
      if (key !== undefined) req = req.set('x-fossflow-key', key);
      if (type !== undefined) req = req.set('Content-Type', type);
      return req.send(body);
    };

    it('answers 401 for a missing, malformed, unknown or deleted key', async () => {
      const doomed = await createKey(owner, shop, 'doomed');
      assert.equal((await owner.delete(`/api/ingest-keys/${doomed.id}`)).status, 204);
      const unknown = `ffi_${'A'.repeat(43)}`;
      for (const key of [undefined, 'ffi_short', unknown, doomed.key]) {
        const response = await post(key, 'application/json', '{}');
        assert.equal(response.status, 401, String(key));
      }
    });

    it('answers 415 for another content type', async () => {
      assert.equal((await post(shopKey.key, 'text/plain', 'hi')).status, 415);
    });

    it('answers 400 for garbage', async () => {
      const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]);
      assert.equal((await post(shopKey.key, 'application/x-protobuf', garbage)).status, 400);
      assert.equal((await post(shopKey.key, 'application/json', '{')).status, 400);
      assert.equal((await post(shopKey.key, 'application/json', '{"resourceSpans":5}')).status, 400);
    });

    it('answers 413 above 16 MiB, also once inflated', async () => {
      const big = Buffer.alloc(17 * MIB);
      assert.equal((await post(shopKey.key, 'application/x-protobuf', big)).status, 413);
      const zipped = await http()
        .post('/api/otlp/v1/traces')
        .set('x-fossflow-key', shopKey.key)
        .set('Content-Type', 'application/x-protobuf')
        .set('Content-Encoding', 'gzip')
        .send(gzipSync(big));
      assert.equal(zipped.status, 413);
    });

    it('answers 404 for metrics', async () => {
      const response = await http()
        .post('/api/otlp/v1/metrics')
        .set('x-fossflow-key', shopKey.key)
        .send('{}');
      assert.equal(response.status, 404);
    });

    it('answers 200 to an empty request', async () => {
      const json = await post(shopKey.key, 'application/json', '{}');
      assert.equal(json.status, 200);
      assert.match(json.headers['content-type'] ?? '', /^application\/json/);
      assert.deepEqual(json.body, {});
      const proto = await post(shopKey.key, 'application/x-protobuf', Buffer.alloc(0));
      assert.equal(proto.status, 200);
      assert.match(proto.headers['content-type'] ?? '', /^application\/x-protobuf/);
      assert.equal(proto.headers['content-length'], '0');
    });

    it('limits per key, not per IP', async () => {
      const burst = await createKey(owner, shop, 'burst');
      for (let i = 0; i < 1200; i += 1) {
        const response = await post(burst.key, 'application/json', '{}');
        assert.equal(response.status, 200, `request ${i + 1}`);
      }
      const limited = await post(burst.key, 'application/json', '{}');
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers['retry-after']) > 0);
      assert.equal((await post(shopKey.key, 'application/json', '{}')).status, 200);
    });
  });
});
