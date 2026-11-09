import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, it } from 'vitest';
import { createBeszelClient } from './beszel.js';
import { createLiveHub, type LiveHub } from './hub.js';
import { LIVE_HUB, LiveController } from './live.controller.js';
import { demoLandscape, startFakeBeszel } from './testing/fakeBeszel.js';
import type { LiveSnapshot, LiveStatusResponse } from './types.js';

const silent = { info: () => {}, warn: () => {} };

async function serve(hub: LiveHub | null): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [LiveController],
    providers: [{ provide: LIVE_HUB, useValue: hub }]
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

describe('live routes', () => {
  const apps: INestApplication[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('reports disabled when no source is configured', async () => {
    const app = await serve(null);
    apps.push(app);
    const status = await request(app.getHttpServer()).get('/api/live/status');
    assert.equal(status.headers['cache-control'], 'no-store');
    assert.deepEqual(status.body, { enabled: false, sources: [] });
    const snapshot = await request(app.getHttpServer()).get('/api/live/snapshot');
    assert.equal(snapshot.status, 404);
    assert.deepEqual(snapshot.body, { error: 'Live data is not configured' });
  });

  it('sends no CORS headers', async () => {
    const app = await serve(null);
    apps.push(app);
    const response = await request(app.getHttpServer())
      .get('/api/live/status')
      .set('Origin', 'https://evil.example');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });

  it('serves the snapshot without credentials and keeps it through outages', async () => {
    const fake = await startFakeBeszel(demoLandscape(Date.now()));
    const config = {
      pollSeconds: 30,
      beszel: { url: fake.url, email: fake.email, password: fake.password }
    };
    const hub = createLiveHub({
      config,
      client: createBeszelClient(config.beszel),
      logger: silent
    });
    await hub.syncNow();
    const app = await serve(hub);
    apps.push(app);

    const response = await request(app.getHttpServer()).get('/api/live/snapshot');
    assert.equal(response.headers['cache-control'], 'no-store');
    for (const secret of [fake.password, fake.email, fake.url]) {
      assert.ok(
        !response.text.includes(secret),
        'snapshot must not expose source credentials'
      );
    }
    const snapshot = response.body as LiveSnapshot;
    assert.equal(snapshot.systems.length, 2);
    assert.equal(snapshot.sources[0]?.ok, true);
    const db = snapshot.systems.find((s) => s.name === 'db-01');
    assert.equal(db?.status, 'warning'); // memory 83 %
    assert.equal(
      db?.containers.find((c) => c.name === 'postgres')?.status,
      'critical'
    );

    await fake.close();
    await hub.syncNow();
    const afterOutage = (
      await request(app.getHttpServer()).get('/api/live/snapshot')
    ).body as LiveSnapshot;
    assert.equal(afterOutage.systems.length, 2, 'last good systems are kept');
    assert.equal(afterOutage.sources[0]?.ok, false);
    assert.match(afterOutage.sources[0]?.error ?? '', /unreachable/);
    const status = (await request(app.getHttpServer()).get('/api/live/status'))
      .body as LiveStatusResponse;
    assert.equal(status.enabled, true);
  });

  it('builds history across syncs', async () => {
    const fake = await startFakeBeszel(demoLandscape(Date.now()));
    const config = {
      pollSeconds: 30,
      beszel: { url: fake.url, email: fake.email, password: fake.password }
    };
    const hub = createLiveHub({
      config,
      client: createBeszelClient(config.beszel),
      logger: silent
    });
    await hub.syncNow();
    await hub.syncNow();
    const web = hub.getSnapshot().systems.find((s) => s.name === 'web-01');
    assert.deepEqual(web?.history.cpu, [34, 34]);
    await fake.close();
  });
});

describe('live hub staleness', () => {
  it('shows last-known data as unknown after three missed poll intervals', async () => {
    const fake = await startFakeBeszel(demoLandscape(Date.now()));
    let clock = Date.now();
    const config = {
      pollSeconds: 30,
      beszel: { url: fake.url, email: fake.email, password: fake.password }
    };
    const hub = createLiveHub({
      config,
      client: createBeszelClient(config.beszel),
      logger: silent,
      now: () => new Date(clock)
    });
    await hub.syncNow();
    await fake.close();

    clock += 60_000; // two intervals: still trusted
    await hub.syncNow();
    assert.notEqual(hub.getSnapshot().systems[0]?.status, 'unknown');

    clock += 60_000; // four intervals since the last good sync
    const stale = hub.getSnapshot();
    assert.ok(stale.systems.length > 0, 'numbers stay available');
    for (const system of stale.systems) {
      assert.equal(system.status, 'unknown');
      for (const container of system.containers) {
        assert.equal(container.status, 'unknown');
      }
    }
  });
});
