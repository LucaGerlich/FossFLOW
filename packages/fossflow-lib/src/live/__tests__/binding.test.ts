import { modelItemSchema, rectangleSchema } from 'src/schemas';
import {
  transformFromCompactFormat,
  transformToCompactFormat
} from 'src/utils/exportOptions';
import type { Model } from 'src/types';

describe('live bindings in the model', () => {
  it('accepts optional live keys on nodes and rectangles', () => {
    expect(
      modelItemSchema.safeParse({
        id: 'a',
        name: 'app',
        live: { key: 'beszel:s1/app' }
      }).success
    ).toBe(true);
    expect(modelItemSchema.safeParse({ id: 'a', name: 'app' }).success).toBe(
      true
    );
    expect(
      rectangleSchema.safeParse({
        id: 'r',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        live: { key: 'beszel:s1' }
      }).success
    ).toBe(true);
  });

  it('rejects empty or oversized keys', () => {
    expect(
      modelItemSchema.safeParse({ id: 'a', name: 'a', live: { key: '' } })
        .success
    ).toBe(false);
    expect(
      modelItemSchema.safeParse({
        id: 'a',
        name: 'a',
        live: { key: 'x'.repeat(301) }
      }).success
    ).toBe(false);
  });

  it('keeps bindings through the compact export format', () => {
    const model: Model = {
      title: 'Compact',
      colors: [],
      icons: [],
      items: [
        {
          id: '1',
          name: 'app',
          icon: 'hairline-container',
          live: { key: 'beszel:s1/app' }
        },
        { id: '2', name: 'notes' }
      ],
      views: [
        {
          id: 'v',
          name: 'Main',
          items: [
            { id: '1', tile: { x: 0, y: 0 } },
            { id: '2', tile: { x: 2, y: 0 } }
          ]
        }
      ]
    };
    const restored = transformFromCompactFormat(
      transformToCompactFormat(model)
    );
    expect(restored.items[0]?.live).toEqual({ key: 'beszel:s1/app' });
    expect(restored.items[1]).not.toHaveProperty('live');
  });
});
