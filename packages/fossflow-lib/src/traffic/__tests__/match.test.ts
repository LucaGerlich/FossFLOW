import type { Connector, ModelItem } from 'src/types';
import {
  boxOf,
  buildTrafficIndex,
  createRouter,
  findArrow,
  matchesIdentity
} from '../match';

const item = (id: string, ids: string[]): ModelItem => ({
  id,
  name: id,
  traffic: { ids }
});

const connector = (
  id: string,
  first: { item?: string; tile?: { x: number; y: number } },
  last: { item?: string; tile?: { x: number; y: number } }
): Connector => ({
  id,
  anchors: [
    { id: `${id}-a`, ref: first },
    { id: `${id}-b`, ref: last }
  ]
});

describe('matchesIdentity', () => {
  it.each([
    ['host:*.magicline.com', 'host:api.magicline.com', true],
    ['host:*.magicline.com', 'host:a.b.magicline.com', true],
    ['host:*.magicline.com', 'host:magicline.com', false],
    ['host:*.magicline.com', 'host:evilmagicline.com', false],
    ['host:*.magicline.com', 'service:x.magicline.com', false],
    ['host:*.magicline.com', 'host:.magicline.com', false],
    ['service:a', 'service:a', true],
    ['service:a', 'service:b', false]
  ])('%s vs %s -> %s', (pattern, id, expected) => {
    expect(matchesIdentity(pattern, id)).toBe(expected);
  });
});

describe('boxOf', () => {
  it('lets an alias host belong to the box binding its service', () => {
    const index = buildTrafficIndex(
      [item('box1', ['service:sync'])],
      [{ host: 'host:sync.internal', service: 'service:sync' }]
    );
    expect(boxOf(index, 'host:sync.internal')).toBe('box1');
  });

  it('prefers an exact match over an earlier wildcard', () => {
    const index = buildTrafficIndex(
      [
        item('box1', ['host:*.example.com']),
        item('box2', ['host:api.example.com'])
      ],
      []
    );
    expect(boxOf(index, 'host:api.example.com')).toBe('box2');
    expect(boxOf(index, 'host:www.example.com')).toBe('box1');
  });

  it('picks the first box in model order on ties', () => {
    const index = buildTrafficIndex(
      [item('box1', ['service:a']), item('box2', ['service:a'])],
      []
    );
    expect(boxOf(index, 'service:a')).toBe('box1');
  });

  it('returns null when nothing matches', () => {
    const index = buildTrafficIndex([item('box1', ['service:a'])], []);
    expect(boxOf(index, 'service:zzz')).toBeNull();
  });

  it('ignores items without a binding', () => {
    const index = buildTrafficIndex(
      [{ id: 'plain', name: 'plain' }, item('box1', ['service:a'])],
      []
    );
    expect(boxOf(index, 'service:a')).toBe('box1');
  });
});

describe('findArrow', () => {
  const connectors = [
    connector('c1', { item: 'a' }, { item: 'b' }),
    connector('c2', { item: 'b' }, { item: 'a' })
  ];

  it('finds a connector in both directions with the right reversed flag', () => {
    expect(findArrow(connectors, 'a', 'b')).toEqual({
      connectorId: 'c1',
      reversed: false
    });
    expect(findArrow(connectors.slice(1), 'a', 'b')).toEqual({
      connectorId: 'c2',
      reversed: true
    });
  });

  it('takes the first connector in view order', () => {
    expect(findArrow(connectors, 'b', 'a')?.connectorId).toBe('c1');
  });

  it('ignores ends anchored to tiles', () => {
    const tiled = [connector('c1', { item: 'a' }, { tile: { x: 0, y: 0 } })];
    expect(findArrow(tiled, 'a', 'b')).toBeNull();
  });

  it('returns null for the same box twice', () => {
    const loop = [connector('c1', { item: 'a' }, { item: 'a' })];
    expect(findArrow(loop, 'a', 'a')).toBeNull();
  });
});

describe('createRouter', () => {
  const index = buildTrafficIndex(
    [item('box1', ['service:a']), item('box2', ['service:b'])],
    []
  );
  const connectors = [connector('c1', { item: 'box1' }, { item: 'box2' })];

  it('routes a call to its arrow', () => {
    const route = createRouter(index, connectors);
    expect(route('service:a', 'service:b')).toEqual({
      connectorId: 'c1',
      reversed: false
    });
    expect(route('service:b', 'service:a')).toEqual({
      connectorId: 'c1',
      reversed: true
    });
  });

  it('returns null when either box is missing', () => {
    const route = createRouter(index, connectors);
    expect(route('service:a', 'service:nope')).toBeNull();
    expect(route('service:nope', 'service:b')).toBeNull();
  });
});
