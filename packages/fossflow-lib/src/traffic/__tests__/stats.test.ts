import type { Connector, ModelItem } from 'src/types';
import { buildTrafficIndex } from 'src/traffic/match';
import {
  arrowTraffic,
  boxTrouble,
  isFailing,
  type ArrowTraffic
} from 'src/traffic/stats';
import type { TrafficState } from 'src/traffic/TrafficContext';
import type {
  TrafficFeed,
  TrafficStats,
  TrafficSummary
} from 'src/traffic/types';

const items: ModelItem[] = [
  { id: 'A', name: 'Website', traffic: { ids: ['service:a'] } },
  { id: 'B', name: 'Member app', traffic: { ids: ['service:b'] } },
  { id: 'C', name: 'Database', traffic: { ids: ['db:x/y'] } }
];

const connector = (id: string, from: string, to: string): Connector =>
  ({
    id,
    anchors: [
      { id: `${id}-1`, ref: { item: from } },
      { id: `${id}-2`, ref: { item: to } }
    ]
  }) as Connector;

const connectors = [connector('ab', 'A', 'B'), connector('bc', 'B', 'C')];

const stats = (overrides: Partial<TrafficStats> = {}): TrafficStats => ({
  calls: 100,
  failures: 0,
  callsPerMin: 20,
  failedPct: 0,
  p50Ms: 50,
  p95Ms: 200,
  ...overrides
});

const summaryOf = (
  edges: { caller: string; callee: string; stats: Partial<TrafficStats> }[],
  services: TrafficSummary['services'] = []
): TrafficSummary => ({
  generatedAt: '2026-01-01T00:00:00Z',
  windowMinutes: 5,
  edges: edges.map((edge) => ({
    caller: edge.caller,
    callee: edge.callee,
    lastSeenAt: '2026-01-01T00:00:00Z',
    ...stats(edge.stats)
  })),
  callees: [],
  services,
  aliases: []
});

const stateOf = (summary: TrafficSummary): TrafficState => {
  const index = buildTrafficIndex(items, summary.aliases);
  const feed: TrafficFeed = {
    summary,
    subscribe: () => () => undefined,
    loadEdge: () => Promise.reject(new Error('unused'))
  };
  return {
    feed,
    index,
    arrows: arrowTraffic(summary, index, connectors),
    weights: new Map()
  };
};

const names = new Map(items.map((item) => [item.id, item.name]));

describe('arrowTraffic', () => {
  it('sums both directions of one arrow and lists both pairs', () => {
    const summary = summaryOf([
      {
        caller: 'service:a',
        callee: 'service:b',
        stats: { calls: 300, failures: 6, callsPerMin: 60, p50Ms: 80, p95Ms: 300 }
      },
      {
        caller: 'service:b',
        callee: 'service:a',
        stats: { calls: 100, failures: 4, callsPerMin: 20, p50Ms: 10, p95Ms: 900 }
      }
    ]);
    const arrow = arrowTraffic(
      summary,
      buildTrafficIndex(items, []),
      connectors
    ).get('ab');

    expect(arrow).toEqual<ArrowTraffic>({
      connectorId: 'ab',
      pairs: [
        { caller: 'service:a', callee: 'service:b' },
        { caller: 'service:b', callee: 'service:a' }
      ],
      callers: ['service:a', 'service:b'],
      calls: 400,
      failures: 10,
      callsPerMin: 80,
      failedPct: 2.5,
      p50Ms: 80,
      p95Ms: 900
    });
  });

  it('skips edges without an arrow', () => {
    const summary = summaryOf([
      { caller: 'service:a', callee: 'db:x/y', stats: {} },
      { caller: 'service:a', callee: 'service:unknown', stats: {} }
    ]);
    expect(
      arrowTraffic(summary, buildTrafficIndex(items, []), connectors).size
    ).toBe(0);
  });
});

describe('isFailing', () => {
  it('needs at least 5 failures and at least 5 percent', () => {
    expect(isFailing({ calls: 10, failures: 4 })).toBe(false);
    expect(isFailing({ calls: 100, failures: 5 })).toBe(true);
    expect(isFailing({ calls: 101, failures: 5 })).toBe(false);
    expect(isFailing({ calls: 0, failures: 0 })).toBe(false);
  });
});

describe('boxTrouble', () => {
  it('picks the worst failing arrow into the box and names its caller', () => {
    const state = stateOf(
      summaryOf([
        {
          caller: 'service:a',
          callee: 'service:b',
          stats: { calls: 100, failures: 10 }
        },
        {
          caller: 'db:x/y',
          callee: 'service:b',
          stats: { calls: 100, failures: 30 }
        },
        {
          caller: 'service:b',
          callee: 'db:x/y',
          stats: { calls: 100, failures: 50 }
        }
      ])
    );
    const trouble = boxTrouble('B', state, names);
    expect(trouble).toEqual({ failedPct: 30, callerName: 'Database' });
  });

  it('falls back to the box own failing services entry', () => {
    const state = stateOf(
      summaryOf(
        [{ caller: 'service:a', callee: 'service:b', stats: { calls: 100 } }],
        [{ service: 'service:b', ...stats({ calls: 200, failures: 20 }) }]
      )
    );
    expect(boxTrouble('B', state, names)).toEqual({
      failedPct: 10,
      callerName: null
    });
  });

  it('is null for a healthy box', () => {
    const state = stateOf(
      summaryOf([
        { caller: 'service:a', callee: 'service:b', stats: { failures: 2 } }
      ])
    );
    expect(boxTrouble('B', state, names)).toBeNull();
  });
});
