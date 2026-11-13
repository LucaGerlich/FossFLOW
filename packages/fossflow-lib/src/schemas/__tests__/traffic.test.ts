import { modelSchema } from '../model';
import { modelItemSchema } from '../modelItems';
import { trafficIdentity } from '../common';

const model = (items: unknown[]) => ({
  title: 'Test',
  items,
  views: [],
  icons: [],
  colors: []
});

describe('traffic binding', () => {
  it('accepts valid identities and survives a JSON round trip', () => {
    const data = model([
      {
        id: 'item1',
        name: 'Box',
        traffic: { ids: ['service:a', 'host:*.b.com', 'db:x.net/members'] }
      }
    ]);
    const result = modelSchema.safeParse(data);
    expect(result.success).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify(data));
    expect(modelSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped).toEqual(data);
  });

  it('keeps the binding when parsing an item', () => {
    const parsed = modelItemSchema.parse({
      id: 'i',
      name: 'n',
      traffic: { ids: ['service:a'] }
    });
    expect(parsed.traffic).toEqual({ ids: ['service:a'] });
  });

  it('still accepts a model without traffic', () => {
    expect(
      modelSchema.safeParse(model([{ id: 'item1', name: 'Box' }])).success
    ).toBe(true);
  });

  it('rejects more than 20 ids', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `service:s${i}`);
    expect(
      modelItemSchema.safeParse({ id: 'i', name: 'n', traffic: { ids } })
        .success
    ).toBe(false);
  });

  it.each([
    ['unknown prefix', 'ftp:x'],
    ['too long', `service:${'a'.repeat(293)}`],
    ['inner wildcard', 'host:a*b'],
    ['empty', ''],
    ['control character', 'service:a\u0001b']
  ])('rejects an identity: %s', (_label, value) => {
    expect(trafficIdentity.safeParse(value).success).toBe(false);
  });

  it('accepts a 300 character identity', () => {
    expect(
      trafficIdentity.safeParse(`service:${'a'.repeat(292)}`).success
    ).toBe(true);
  });
});
