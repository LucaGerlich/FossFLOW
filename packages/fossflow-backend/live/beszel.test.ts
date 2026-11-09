import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { LiveSourceError, createBeszelClient } from './beszel.ts';
import {
  demoLandscape,
  startFakeBeszel,
  type FakeBeszel
} from './testing/fakeBeszel.ts';

describe('Beszel client', () => {
  let fake: FakeBeszel;

  before(async () => {
    fake = await startFakeBeszel(demoLandscape(Date.now()));
  });
  after(() => fake.close());

  const client = () =>
    createBeszelClient({
      url: fake.url,
      email: fake.email,
      password: fake.password
    });
  const logins = () =>
    fake.requests.filter((r) => r.endsWith('/auth-with-password')).length;

  it('fetches systems and containers and reuses its token', async () => {
    const beszel = client();
    const before = logins();
    const first = await beszel.fetchInventory();
    await beszel.fetchInventory();
    assert.equal(first.systems.length, 2);
    assert.equal(first.containers.length, 6);
    assert.equal(first.skipped, 0);
    assert.equal(logins() - before, 1);
  });

  it('logs in again once when the token is rejected', async () => {
    const beszel = client();
    await beszel.fetchInventory();
    const before = logins();
    fake.revokeTokens();
    const result = await beszel.fetchInventory();
    assert.equal(result.systems.length, 2);
    assert.equal(logins() - before, 1);
  });

  it('reports wrong credentials without leaking them', async () => {
    const beszel = createBeszelClient({
      url: fake.url,
      email: fake.email,
      password: 'nope-123'
    });
    await assert.rejects(beszel.fetchInventory(), (error: unknown) => {
      assert.ok(error instanceof LiveSourceError);
      assert.match(error.message, /login failed \(HTTP 400\)/);
      assert.ok(!error.message.includes('nope-123'));
      return true;
    });
  });

  it('reports an unreachable hub', async () => {
    const beszel = createBeszelClient({
      url: 'http://127.0.0.1:9',
      email: 'a@b.c',
      password: 'x'
    });
    await assert.rejects(beszel.fetchInventory(), /Beszel is unreachable/);
  });

  it('skips malformed records and pages through large lists', async () => {
    const now = Date.now();
    const many = Array.from({ length: 501 }, (_, i) => ({
      system: 'sysweb01',
      name: `c${i}`,
      image: 'busybox',
      status: 'Up',
      health: 0,
      cpu: 0,
      memory: 1,
      updated: now
    }));
    fake.setContainers([...many, { system: 'sysweb01', name: 42 } as never]);
    const result = await client().fetchInventory();
    assert.equal(result.containers.length, 501);
    assert.equal(result.skipped, 1);
  });
});

describe('Beszel client hardening', () => {
  it('never follows redirects, so credentials cannot leak to another host', async () => {
    const target = await startFakeBeszel();
    const redirecting = await startFakeBeszel({ redirectTo: target.url });
    try {
      const beszel = createBeszelClient({
        url: redirecting.url,
        email: target.email,
        password: target.password
      });
      await assert.rejects(beszel.fetchInventory(), LiveSourceError);
      assert.deepEqual(
        target.requests,
        [],
        'redirect target must not be contacted'
      );
    } finally {
      await Promise.all([target.close(), redirecting.close()]);
    }
  });

  it('flags lists that hit the page cap instead of truncating silently', async () => {
    const now = Date.now();
    const fake = await startFakeBeszel({
      systems: [{ id: 's', name: 's', status: 'up', info: {} }],
      containers: Array.from({ length: 10_001 }, (_, i) => ({
        system: 's',
        name: `c${i}`,
        image: 'busybox',
        status: 'Up',
        health: 0,
        cpu: 0,
        memory: 1,
        updated: now
      }))
    });
    try {
      const result = await createBeszelClient({
        url: fake.url,
        email: fake.email,
        password: fake.password
      }).fetchInventory();
      assert.equal(result.truncated, true);
      assert.equal(result.containers.length, 10_000);
    } finally {
      await fake.close();
    }
  });
});
