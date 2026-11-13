import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { bucketOf, DURATION_BOUNDS_MS, emptyHistogram } from './histogram.js';

describe('duration histogram', () => {
  it('puts a duration in the first bucket whose bound it does not exceed', () => {
    assert.equal(bucketOf(0), 0);
    assert.equal(bucketOf(5), 0);
    assert.equal(bucketOf(5.1), 1);
    assert.equal(bucketOf(30000), 20);
    assert.equal(bucketOf(30001), 21);
  });

  it('has one bucket per bound plus an overflow bucket', () => {
    assert.equal(emptyHistogram().length, 22);
    assert.equal(DURATION_BOUNDS_MS.length + 1, 22);
    assert.ok(emptyHistogram().every((count) => count === 0));
  });
});
