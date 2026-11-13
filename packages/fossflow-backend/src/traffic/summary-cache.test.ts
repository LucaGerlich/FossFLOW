import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createSummaryCache } from './summary-cache.js';
import type { TrafficSummary } from './wire.js';

const summaryAt = (now: Date): TrafficSummary => ({
  generatedAt: now.toISOString(),
  windowMinutes: 5,
  edges: [],
  callees: [],
  services: [],
  aliases: []
});

describe('createSummaryCache', () => {
  const setup = (fail = false) => {
    const runs: string[] = [];
    const get = createSummaryCache(async (projectId, now) => {
      runs.push(projectId);
      if (fail && runs.length === 1) throw new Error('db down');
      return summaryAt(now);
    });
    return { runs, get };
  };

  it('runs the query once for calls within five seconds', async () => {
    const { runs, get } = setup();
    const first = await get('p', new Date(0));
    const second = await get('p', new Date(4_999));
    assert.equal(runs.length, 1);
    assert.equal(second, first);
  });

  it('shares one query between concurrent calls', async () => {
    const { runs, get } = setup();
    await Promise.all([get('p', new Date(0)), get('p', new Date(1))]);
    assert.equal(runs.length, 1);
  });

  it('recomputes after five seconds and keeps projects apart', async () => {
    const { runs, get } = setup();
    await get('p', new Date(0));
    await get('q', new Date(1));
    await get('p', new Date(5_000));
    assert.deepEqual(runs, ['p', 'q', 'p']);
  });

  it('evicts a failed query', async () => {
    const { runs, get } = setup(true);
    await assert.rejects(get('p', new Date(0)));
    await get('p', new Date(1));
    assert.equal(runs.length, 2);
  });
});
