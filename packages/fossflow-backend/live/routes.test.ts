import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import express from 'express';
import { createBeszelClient } from './beszel.ts';
import { createLiveHub, type LiveHub } from './hub.ts';
import { createLiveRouter } from './routes.ts';
import { demoLandscape, startFakeBeszel } from './testing/fakeBeszel.ts';
import type { LiveSnapshot, LiveStatusResponse } from './types.ts';

const silent = { info: () => {}, warn: () => {} };

async function serve(
  hub: LiveHub | null
): Promise<{ base: string; server: Server }> {
  const app = express();
  app.use('/api/live', createLiveRouter(hub));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live`,
    server
  };
}

describe('live routes', () => {
  const servers: Server[] = [];
  after(() => servers.forEach((s) => s.close()));

  it('reports disabled when no source is configured', async () => {
    const { base, server } = await serve(null);
    servers.push(server);
    const status = await fetch(`${base}/status`);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { enabled: false, sources: [] });
    assert.equal((await fetch(`${base}/snapshot`)).status, 404);
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
    const { base, server } = await serve(hub);
    servers.push(server);

    const response = await fetch(`${base}/snapshot`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text();
    for (const secret of [fake.password, fake.email, fake.url]) {
      assert.ok(
        !text.includes(secret),
        'snapshot must not expose source credentials'
      );
    }
    const snapshot = JSON.parse(text);
    assert.equal(snapshot.systems.length, 2);
    assert.equal(snapshot.sources[0].ok, true);
    const db = snapshot.systems.find(
      (s: { name: string }) => s.name === 'db-01'
    );
    assert.equal(db.status, 'warning'); // memory 83 %
    assert.equal(
      db.containers.find((c: { name: string }) => c.name === 'postgres').status,
      'critical'
    );

    await fake.close();
    await hub.syncNow();
    const afterOutage = (await (
      await fetch(`${base}/snapshot`)
    ).json()) as LiveSnapshot;
    assert.equal(afterOutage.systems.length, 2, 'last good systems are kept');
    assert.equal(afterOutage.sources[0]?.ok, false);
    assert.match(afterOutage.sources[0]?.error ?? '', /unreachable/);
    const status = (await (
      await fetch(`${base}/status`)
    ).json()) as LiveStatusResponse;
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
    const recent = hub.getSnapshot();
    assert.notEqual(recent.systems[0]?.status, 'unknown');

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
