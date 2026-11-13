import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { trafficMinute } from '../database/schema.js';
import { DB, type Database } from '../database/database.module.js';
import { emptyHistogram } from './histogram.js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person } from '../test/people.js';
import { openStream, type OpenStream, signIn } from '../test/stream.js';
import type { TrafficStreamMessage } from './wire.js';

describe('live traffic stream against real Postgres', () => {
  let t: TestApp;
  let db: Database;
  let baseUrl: string;
  let owner: Browser;
  let vic: Person;
  let eve: Person;
  let mia: Person;
  let ingestKey: string;
  let projectId: string;
  let landscapePath: string;
  let vicCookie: string;
  let miaCookie: string;
  let eveCookie: string;
  const open: OpenStream[] = [];

  const stream = async (path: string, cookie: string): Promise<OpenStream> => {
    const s = await openStream(baseUrl, path, cookie);
    open.push(s);
    return s;
  };

  const postSpan = async (serviceName: string) => {
    const now = BigInt(Date.now()) * 1_000_000n;
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: '0af7651916cd43dd8448eb211c80319c',
                  spanId: 'b7ad6b7169203331',
                  name: 'GET',
                  kind: 3,
                  startTimeUnixNano: String(now - 50_000_000n),
                  endTimeUnixNano: String(now),
                  attributes: [
                    { key: 'http.request.method', value: { stringValue: 'GET' } },
                    { key: 'url.full', value: { stringValue: 'https://api.stream.example/v1/ping' } },
                    { key: 'server.address', value: { stringValue: 'api.stream.example' } }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    const response = await fetch(`${baseUrl}/api/otlp/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fossflow-key': ingestKey,
        'X-Real-IP': '10.77.0.1'
      },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
  };

  beforeAll(async () => {
    t = await startTestApp();
    db = t.app.get<Database>(DB);
    await t.app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    vic = await joinAs(t, owner, 'Vic');
    eve = await joinAs(t, owner, 'Eve');
    mia = await joinAs(t, owner, 'Mia');
    const project = (await owner.post('/api/projects', { name: 'Shop' })).body.id as string;
    projectId = project;
    await owner.put(`/api/projects/${project}/members/${vic.id}`, { role: 'project:viewer' });
    await owner.put(`/api/projects/${project}/members/${mia.id}`, { role: 'project:viewer' });
    const landscape = (await owner.post(`/api/projects/${project}/landscapes`, { name: 'Map' })).body
      .id as string;
    landscapePath = `/api/landscapes/${landscape}/traffic/stream`;
    ingestKey = (await owner.post(`/api/projects/${project}/ingest-keys`, { name: 'app' })).body
      .key as string;
    vicCookie = await signIn(baseUrl, 'vic@example.com', 'Vic-pass-1A');
    miaCookie = await signIn(baseUrl, 'mia@example.com', 'Mia-pass-1A');
    eveCookie = await signIn(baseUrl, 'eve@example.com', 'Eve-pass-1A');
    assert.ok(vicCookie && miaCookie && eveCookie);
  });
  afterAll(async () => {
    for (const s of open) s.close();
    await t?.close();
  });

  it('streams the project’s calls to a viewer', async () => {
    const s = await stream(landscapePath, vicCookie);
    assert.equal(s.status, 200);
    assert.match(s.headers.get('content-type') ?? '', /^text\/event-stream/);
    assert.equal(s.headers.get('x-accel-buffering'), 'no');
    assert.equal(await s.next(), 'retry: 2000');
    await postSpan('stream-app');
    const block = await s.next();
    assert.match(block, /^data: /);
    const parsed = JSON.parse(block.slice('data: '.length)) as TrafficStreamMessage;
    assert.equal(parsed.dots.length, 1);
    assert.equal(parsed.dots[0]?.caller, 'service:stream-app');
    assert.equal(parsed.dots[0]?.callee, 'host:api.stream.example');
    s.close();
  });

  describe('summary and edge reads', () => {
    const base = (): string => landscapePath.replace('/stream', '');
    const pairQuery = 'caller=service%3Abilling%20api&callee=db%3Asql.example.net%2Fmembers';

    it('serves a viewer, without caching', async () => {
      const summary = await vic.browser.get(`${base()}/summary`);
      assert.equal(summary.status, 200);
      assert.equal(summary.headers['cache-control'], 'no-store');
      assert.deepEqual(summary.body.edges, []);
      const edge = await vic.browser.get(`${base()}/edge?${pairQuery}`);
      assert.equal(edge.status, 200);
      assert.equal(edge.headers['cache-control'], 'no-store');
      assert.equal(edge.body.range, '1h');
      assert.equal(edge.body.series.length, 60);
    });

    it('answers 404 to an outsider and 401 when signed out', async () => {
      assert.equal((await eve.browser.get(`${base()}/summary`)).status, 404);
      assert.equal((await eve.browser.get(`${base()}/edge?${pairQuery}`)).status, 404);
      assert.equal((await t.browser().get(`${base()}/summary`)).status, 401);
      assert.equal((await t.browser().get(`${base()}/edge?${pairQuery}`)).status, 401);
    });

    it('round-trips an encoded identity and repeated pairs', async () => {
      const now = new Date();
      now.setSeconds(0, 0);
      await db.insert(trafficMinute).values({
        projectId,
        kind: 'call',
        caller: 'service:billing api',
        callee: 'db:sql.example.net/members',
        operation: 'SELECT',
        minute: now,
        calls: 4,
        failures: 0,
        durationSumMs: 40,
        histogram: emptyHistogram()
      });
      const edge = await vic.browser.get(
        `${base()}/edge?${pairQuery}&caller=service%3Aother&callee=host%3Aother&range=24h`
      );
      assert.equal(edge.status, 200);
      assert.equal(edge.body.range, '24h');
      assert.equal(edge.body.totals.calls, 4);
      assert.equal(edge.body.operations[0].operation, 'SELECT');
    });

    it.each([
      ['an unknown range', `${pairQuery}&range=2h`],
      ['more callers than callees', `${pairQuery}&caller=service%3Aextra`],
      ['no pairs', 'range=1h'],
      ['21 pairs', Array.from({ length: 21 }, (_, i) => `caller=a${i}&callee=b${i}`).join('&')],
      ['a 301-character identity', `caller=${'x'.repeat(301)}&callee=host%3Ab`]
    ])('rejects %s with 400', async (_name, query) => {
      const response = await vic.browser.get(`${base()}/edge?${query}`);
      assert.equal(response.status, 400);
      assert.ok(!JSON.stringify(response.body).includes('x'.repeat(301)));
    });
  });

  it('answers 404 to an outsider and 401 when signed out', async () => {
    assert.equal((await stream(landscapePath, eveCookie)).status, 404);
    assert.equal((await stream(landscapePath, '')).status, 401);
  });

  it('refuses the 11th stream of one user, and frees a slot on close', async () => {
    const streams: OpenStream[] = [];
    for (let i = 0; i < 10; i += 1) {
      const s = await stream(landscapePath, vicCookie);
      assert.equal(s.status, 200, `stream ${i + 1}`);
      await s.next();
      streams.push(s);
    }
    assert.equal((await stream(landscapePath, vicCookie)).status, 429);
    streams[0]?.close();
    let reopened: OpenStream | undefined;
    for (let attempt = 0; attempt < 50 && reopened?.status !== 200; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      reopened = await stream(landscapePath, vicCookie);
    }
    assert.equal(reopened?.status, 200);
    for (const s of streams) s.close();
    reopened?.close();
  });

  it('refuses a removed member on reconnect', async () => {
    const first = await stream(landscapePath, miaCookie);
    assert.equal(first.status, 200);
    first.close();
    assert.equal((await owner.delete(`/api/projects/${projectId}/members/${mia.id}`)).status, 204);
    assert.equal((await stream(landscapePath, miaCookie)).status, 404);
  });

  it('does not leak slots for clients that hang up straight away', async () => {
    const quick = Array.from({ length: 12 }, () => {
      const controller = new AbortController();
      const request = fetch(`${baseUrl}${landscapePath}`, {
        headers: { Cookie: vicCookie, Origin: 'http://fossflow.test', 'X-Real-IP': '10.88.0.1' },
        signal: controller.signal
      }).catch(() => undefined);
      controller.abort();
      return request;
    });
    await Promise.all(quick);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const s = await stream(landscapePath, vicCookie);
    assert.equal(s.status, 200);
    s.close();
  });
});
