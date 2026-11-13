import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { bucketOf, DURATION_BOUNDS_MS, emptyHistogram, percentileMs } from './histogram.js';

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

  describe('percentileMs', () => {
    const histogram = (counts: Record<number, number>): number[] => {
      const result = emptyHistogram();
      for (const [index, count] of Object.entries(counts)) result[Number(index)] = count;
      return result;
    };

    it('is null without calls', () => {
      assert.equal(percentileMs(emptyHistogram(), 0.5), null);
    });

    it('interpolates inside the bucket that holds the rank', () => {
      const ten = histogram({ 6: 10 });
      assert.equal(percentileMs(ten, 0.5), 87.5);
      assert.equal(percentileMs(ten, 0.95), 98.75);
    });

    it('answers 30000 for the overflow bucket', () => {
      const skewed = histogram({ 0: 90, 21: 10 });
      assert.ok(Math.abs((percentileMs(skewed, 0.5) ?? 0) - 2.78) < 0.005);
      assert.equal(percentileMs(skewed, 0.95), 30000);
    });
  });
});
