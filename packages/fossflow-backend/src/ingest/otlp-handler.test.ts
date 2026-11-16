import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, it } from 'vitest';
import type { TrafficAggregator } from '../traffic/aggregator.js';
import type { TrafficHub } from '../traffic/hub.js';
import type { IngestKeysService } from './ingest-keys.service.js';
import { createKeyLimiter, createOtlpHandler } from './otlp-handler.js';

describe('createKeyLimiter', () => {
  it('allows the limit, then says when to retry', () => {
    const limiter = createKeyLimiter(3, 60_000);
    for (let i = 0; i < 3; i += 1) assert.deepEqual(limiter.take('a', 0), { ok: true });
    assert.deepEqual(limiter.take('a', 0), { ok: false, retryAfterSeconds: 60 });
    assert.deepEqual(limiter.take('a', 59_000), { ok: false, retryAfterSeconds: 1 });
    assert.deepEqual(limiter.take('a', 60_000), { ok: true });
  });

  it('keeps a window per key', () => {
    const limiter = createKeyLimiter(1, 60_000);
    assert.deepEqual(limiter.take('a', 0), { ok: true });
    assert.deepEqual(limiter.take('b', 0), { ok: true });
    assert.equal(limiter.take('a', 1).ok, false);
  });
});

describe('createOtlpHandler', () => {
  it('still answers 200 and counts the batch once when the live view throws', async () => {
    let added = 0;
    const handler = createOtlpHandler({
      keys: {
        authenticate: async () => ({ id: 'k', projectId: 'p' })
      } as unknown as IngestKeysService,
      aggregator: {
        add: () => {
          added += 1;
        }
      } as unknown as TrafficAggregator,
      hub: {
        publish: () => {
          throw new Error('boom');
        }
      } as unknown as TrafficHub
    });
    const app = express();
    app.post('/v1/traces', handler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fossflow-key': 'k' },
        body: '{}'
      });
      assert.equal(response.status, 200);
      assert.equal(added, 1);
    } finally {
      server.close();
    }
  });
});
