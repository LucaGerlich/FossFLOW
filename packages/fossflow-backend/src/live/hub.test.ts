import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { beszelConnector } from '../connectors/beszel.js';
import { createLiveHub } from './hub.js';
import { demoLandscape, startFakeBeszel } from './testing/fakeBeszel.js';

const silent = { info: () => {}, warn: () => {} };
const SOURCE = { id: 'cred-1', type: 'beszel', name: 'Production Beszel' };

async function hubFor(clock?: () => Date) {
  const fake = await startFakeBeszel(demoLandscape(Date.now()));
  const hub = createLiveHub({
    source: SOURCE,
    client: beszelConnector.open({ url: fake.url, email: fake.email, password: fake.password }),
    pollSeconds: 30,
    logger: silent,
    now: clock
  });
  return { fake, hub };
}

describe('live hub with the Beszel connector', () => {
  it('serves systems keyed by the credential, without its secrets', async () => {
    const { fake, hub } = await hubFor();
    await hub.syncNow();
    const snapshot = hub.getSnapshot();
    const text = JSON.stringify(snapshot);
    for (const secret of [fake.password, fake.email, fake.url]) {
      assert.ok(!text.includes(secret), 'snapshots must not expose source credentials');
    }
    assert.equal(snapshot.systems.length, 2);
    assert.ok(snapshot.systems.every((s) => s.key.startsWith('cred-1:')));
    assert.deepEqual(snapshot.sources, [
      { ...SOURCE, ok: true, lastSync: snapshot.updatedAt, error: null }
    ]);
    const db = snapshot.systems.find((s) => s.name === 'db-01');
    assert.equal(db?.status, 'warning'); // memory 83 %
    assert.equal(db?.containers.find((c) => c.name === 'postgres')?.status, 'critical');
    await fake.close();
  });

  it('keeps the last good systems through an outage and reports the error', async () => {
    const { fake, hub } = await hubFor();
    await hub.syncNow();
    await fake.close();
    await hub.syncNow();
    const snapshot = hub.getSnapshot();
    assert.equal(snapshot.systems.length, 2, 'last good systems are kept');
    assert.equal(snapshot.sources[0]?.ok, false);
    assert.match(snapshot.sources[0]?.error ?? '', /unreachable/);
    assert.equal(hub.getHealth().ok, false);
  });

  it('builds history across syncs', async () => {
    const { fake, hub } = await hubFor();
    await hub.syncNow();
    await hub.syncNow();
    const web = hub.getSnapshot().systems.find((s) => s.name === 'web-01');
    assert.deepEqual(web?.history.cpu, [34, 34]);
    await fake.close();
  });

  it('shows last-known data as unknown after three missed poll intervals', async () => {
    let clock = Date.now();
    const { fake, hub } = await hubFor(() => new Date(clock));
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
      for (const container of system.containers) assert.equal(container.status, 'unknown');
    }
  });
});

describe('Beszel connector settings', () => {
  it('normalises the hub URL and refuses unsafe ones', () => {
    assert.deepEqual(
      beszelConnector.validate({ url: 'https://beszel.example.com/', email: 'a@b.de', password: 'x' }),
      { url: 'https://beszel.example.com', email: 'a@b.de', password: 'x' }
    );
    assert.throws(() =>
      beszelConnector.validate({ url: 'ftp://beszel.example.com', email: 'a@b.de', password: 'x' })
    );
    assert.throws(() =>
      beszelConnector.validate({ url: 'https://user:pw@beszel.example.com', email: 'a@b.de', password: 'x' })
    );
    assert.throws(() => beszelConnector.validate({ url: 'https://ok.example', email: 'nope', password: 'x' }));
  });

  it('marks only the password as secret', () => {
    assert.deepEqual(
      beszelConnector.fields.filter((field) => field.secret).map((field) => field.name),
      ['password']
    );
  });
});
