import { describe, expect, it } from 'vitest';
import type { LandscapeModel } from '../landscapes/model.js';
import { rewriteLiveKeys } from './rekey.js';

const model = (): LandscapeModel => ({
  icons: [],
  colors: [],
  items: [
    { id: 'a', name: 'Host', live: { key: 'beszel:sys1' } },
    { id: 'b', name: 'App', live: { key: 'beszel:sys1/web' } },
    { id: 'c', name: 'Other', live: { key: 'other:sys9' } },
    { id: 'd', name: 'beszel:not-a-binding' }
  ],
  views: [
    {
      id: 'v',
      items: [],
      rectangles: [
        {
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          live: { key: 'beszel:sys1', known: ['beszel:sys1/web', 'other:x/y'] }
        }
      ]
    },
    { id: 'w', items: [] }
  ]
});

describe('rewriteLiveKeys', () => {
  it('moves keys of one source to another, on nodes and plates', () => {
    const before = model();
    const { model: after, changed } = rewriteLiveKeys(before, 'beszel', 'cred-1');

    expect(changed).toBe(true);
    expect(after.items.map((item) => (item.live as { key: string } | undefined)?.key)).toEqual([
      'cred-1:sys1',
      'cred-1:sys1/web',
      'other:sys9',
      undefined
    ]);
    expect(after.items[3]).toEqual({ id: 'd', name: 'beszel:not-a-binding' });
    expect(after.views[0]?.rectangles?.[0]?.live).toEqual({
      key: 'cred-1:sys1',
      known: ['cred-1:sys1/web', 'other:x/y']
    });
    expect(after.views[1]).toEqual({ id: 'w', items: [] });
    // The input is left as it was.
    expect(before).toEqual(model());
  });

  it('reports no change when nothing is bound to the source', () => {
    const before = model();
    const result = rewriteLiveKeys(before, 'nothing', 'cred-1');
    expect(result.changed).toBe(false);
    expect(result.model).toBe(before);
  });
});
