import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { BeszelContainer, BeszelSystem } from './beszel.js';
import {
  STALE_CONTAINER_MS,
  detectKind,
  normalizeInventory,
  systemStatus,
  toContainer,
  toVitals
} from './normalize.js';

const NOW = 1_800_000_000_000;

const container = (
  overrides: Partial<BeszelContainer> = {}
): BeszelContainer => ({
  system: 'sys1',
  name: 'app',
  image: 'ghcr.io/acme/app:1.0',
  status: 'Up 1 hour',
  health: 0,
  cpu: 12.345,
  memory: 256,
  updated: NOW,
  ...overrides
});

const system = (overrides: Partial<BeszelSystem> = {}): BeszelSystem => ({
  id: 'sys1',
  name: 'web-01',
  status: 'up',
  info: { cpu: 10, mp: 20, dp: 30, bb: 1000, la: [1, 2, 3], u: 60, dt: 41.27 },
  updated: undefined,
  ...overrides
});

describe('detectKind', () => {
  const cases: Array<[string, string]> = [
    ['postgres:16', 'database'],
    ['docker.io/library/mariadb:11', 'database'],
    ['bitnami/mongodb:7', 'database'],
    ['redis:7-alpine', 'cache'],
    ['valkey/valkey:8', 'cache'],
    ['nats:2', 'queue'],
    ['rabbitmq:3-management', 'queue'],
    ['traefik:v3.2', 'gateway'],
    ['nginx@sha256:abc', 'gateway'],
    ['ghcr.io/acme/app:1.14', 'container'],
    ['ghcr.io/acme/postgres-backup-tool-free', 'database'],
    ['', 'container']
  ];
  for (const [image, kind] of cases) {
    it(`${image || '(empty)'} → ${kind}`, () =>
      assert.equal(detectKind(image), kind));
  }
});

describe('systemStatus', () => {
  const vitals = toVitals({ cpu: 10, mp: 10, dp: 10 });
  it('maps Beszel states', () => {
    assert.equal(systemStatus('down', vitals), 'critical');
    assert.equal(systemStatus('paused', vitals), 'unknown');
    assert.equal(systemStatus('pending', vitals), 'unknown');
    assert.equal(systemStatus('up', vitals), 'ok');
  });
  it('escalates on the busiest vital', () => {
    assert.equal(systemStatus('up', { ...vitals, disk: 80 }), 'warning');
    assert.equal(systemStatus('up', { ...vitals, memory: 90 }), 'critical');
  });
});

describe('toContainer', () => {
  it('builds a stable key from system id and container name', () => {
    assert.equal(toContainer('beszel', container()).key, 'beszel:sys1/app');
  });
  it('maps Docker health codes to status', () => {
    assert.equal(toContainer('b', container({ health: 3 })).status, 'critical');
    assert.equal(toContainer('b', container({ health: 1 })).status, 'warning');
    assert.equal(toContainer('b', container({ health: 2 })).health, 'healthy');
    assert.equal(toContainer('b', container({ health: 42 })).health, 'none');
  });
  it('rounds numbers and flags updates', () => {
    const result = toContainer('b', container({ updatable: true }));
    assert.equal(result.cpu, 12.3);
    assert.equal(result.updateAvailable, true);
  });
});

describe('toVitals', () => {
  it('falls back to the deprecated MB/s bandwidth field and tolerates missing info', () => {
    assert.equal(toVitals({ b: 2 }).networkBytesPerSec, 2 * 1024 * 1024);
    assert.deepEqual(toVitals(null), {
      cpu: 0,
      memory: 0,
      disk: 0,
      networkBytesPerSec: 0,
      load: null,
      uptimeSec: 0,
      temperatureC: null
    });
  });
});

describe('normalizeInventory: stopped containers', () => {
  it('drops containers missing from the system’s latest agent report', () => {
    const [result] = normalizeInventory({
      sourceId: 'beszel',
      systems: [system({ updated: NOW })],
      containers: [
        container({ name: 'running', updated: NOW }),
        container({ name: 'just-reported', updated: NOW - 30_000 }),
        container({ name: 'stopped', updated: NOW - 120_000 })
      ],
      historyFor: () => ({ cpu: [], memory: [], disk: [] }),
      nowMs: NOW
    });
    assert.deepEqual(
      result?.containers.map((c) => c.name),
      ['just-reported', 'running']
    );
  });
});

describe('normalizeInventory', () => {
  it('groups fresh containers under their system and drops stale ones', () => {
    const [result] = normalizeInventory({
      sourceId: 'beszel',
      systems: [system()],
      containers: [
        container({ name: 'zeta' }),
        container({ name: 'alpha' }),
        container({ name: 'gone', updated: NOW - STALE_CONTAINER_MS - 1 }),
        container({ name: 'other', system: 'sys2' })
      ],
      historyFor: () => ({ cpu: [1], memory: [2], disk: [3] }),
      nowMs: NOW
    });
    assert.ok(result);
    assert.equal(result.key, 'beszel:sys1');
    assert.deepEqual(
      result.containers.map((c) => c.name),
      ['alpha', 'zeta']
    );
    assert.equal(result.vitals.temperatureC, 41.3);
    assert.deepEqual(result.history.cpu, [1]);
  });
});
