import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createKeyLimiter } from './otlp-handler.js';

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
