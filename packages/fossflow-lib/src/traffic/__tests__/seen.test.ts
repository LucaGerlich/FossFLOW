import { buildTrafficIndex } from 'src/traffic/match';
import { seenEntries, suggestIdentities } from 'src/traffic/seen';
import { summaryOf } from 'src/traffic/__fixtures__/feed';
import type { Connector, ModelItem } from 'src/types';

const items: ModelItem[] = [
  { id: 'web', name: 'Website', traffic: { ids: ['service:web'] } },
  { id: 'app', name: 'Member app', traffic: { ids: ['service:app'] } },
  { id: 'db', name: 'Database', traffic: { ids: ['db:sql/members'] } }
];

const arrow = (from: string, to: string): Connector => ({
  id: `${from}-${to}`,
  color: 'c',
  anchors: [
    { id: 'a1', ref: { item: from } },
    { id: 'a2', ref: { item: to } }
  ]
});

const run = (
  edges: Parameters<typeof summaryOf>[0],
  connectors: Connector[] = [],
  aliases: { host: string; service: string }[] = []
) => {
  const summary = { ...summaryOf(edges), aliases };
  const index = buildTrafficIndex(items, aliases);
  return { summary, index, result: seenEntries(summary, index, connectors) };
};

describe('seenEntries', () => {
  it('leaves out identities that have a box', () => {
    const { result } = run([
      { caller: 'service:web', callee: 'service:app', stats: {} },
      { caller: 'service:app', callee: 'host:api.example.com', stats: { calls: 7 } }
    ]);
    expect(result.unplaced.map((entry) => entry.identity)).toEqual([
      'host:api.example.com'
    ]);
    expect(result.unplaced[0].calls).toBe(7);
  });

  it('hides an aliased host behind its service', () => {
    const { result } = run(
      [{ caller: 'service:web', callee: 'host:b.internal', stats: {} }],
      [],
      [{ host: 'host:b.internal', service: 'service:b' }]
    );
    expect(result.unplaced).toEqual([]);
  });

  it('lists a service from the summary that has no box', () => {
    const summary = summaryOf([], [
      {
        service: 'service:billing',
        calls: 9,
        failures: 0,
        callsPerMin: 2,
        failedPct: 0,
        p50Ms: 1,
        p95Ms: 2
      }
    ]);
    const result = seenEntries(summary, buildTrafficIndex(items, []), []);
    expect(result.unplaced.map((entry) => entry.identity)).toEqual([
      'service:billing'
    ]);
    expect(suggestIdentities(summary, buildTrafficIndex(items, []))).toEqual([
      'service:billing'
    ]);
  });

  it('lists a pair of placed boxes without an arrow, caller first', () => {
    const { result } = run([
      { caller: 'service:app', callee: 'db:sql/members', stats: { calls: 40 } }
    ]);
    expect(result.unconnected).toEqual([
      { fromItemId: 'app', toItemId: 'db', calls: 40 }
    ]);
  });

  it('skips pairs with an arrow in either direction', () => {
    const forward = run(
      [{ caller: 'service:web', callee: 'service:app', stats: {} }],
      [arrow('web', 'app')]
    );
    const backward = run(
      [{ caller: 'service:web', callee: 'service:app', stats: {} }],
      [arrow('app', 'web')]
    );
    expect(forward.result.unconnected).toEqual([]);
    expect(backward.result.unconnected).toEqual([]);
  });

  it('skips pairs inside one box', () => {
    const sameBox: ModelItem[] = [
      { id: 'one', name: 'One', traffic: { ids: ['service:a', 'service:b'] } }
    ];
    const summary = summaryOf([
      { caller: 'service:a', callee: 'service:b', stats: {} }
    ]);
    const result = seenEntries(summary, buildTrafficIndex(sameBox, []), []);
    expect(result.unconnected).toEqual([]);
  });

  it('merges both directions of a pair into one entry', () => {
    const { result } = run([
      { caller: 'service:web', callee: 'service:app', stats: { calls: 10 } },
      { caller: 'service:app', callee: 'service:web', stats: { calls: 5 } }
    ]);
    expect(result.unconnected).toEqual([
      { fromItemId: 'web', toItemId: 'app', calls: 15 }
    ]);
  });

  it('sorts by calls, then last seen, and caps at 50', () => {
    const base = summaryOf([
      { caller: 'service:web', callee: 'host:a', stats: { calls: 5 } },
      { caller: 'service:web', callee: 'host:b', stats: { calls: 5 } },
      { caller: 'service:web', callee: 'host:c', stats: { calls: 9 } }
    ]);
    const summary = {
      ...base,
      edges: base.edges.map((edge, i) => ({
        ...edge,
        lastSeenAt: `2026-01-01T00:00:0${i}Z`
      }))
    };
    const index = buildTrafficIndex(items, []);
    const sorted = seenEntries(summary, index, []).unplaced.map(
      (entry) => entry.identity
    );
    expect(sorted).toEqual(['host:c', 'host:b', 'host:a']);

    const many = summaryOf(
      Array.from({ length: 80 }, (_, i) => ({
        caller: 'service:web',
        callee: `host:h${i}`,
        stats: { calls: i }
      }))
    );
    const capped = seenEntries(many, index, []);
    expect(capped.unplaced).toHaveLength(50);
    expect(capped.unplaced[0].identity).toBe('host:h79');
  });
});

describe('identities the schema rejects', () => {
  const edges = [
    { caller: 'service:a*b', callee: 'service:app', stats: { calls: 5 } }
  ];

  it('are neither unplaced nor suggested', () => {
    const { summary, index, result } = run(edges);
    expect(result.unplaced.map((entry) => entry.identity)).toEqual([]);
    expect(suggestIdentities(summary, index)).toEqual([]);
  });
});

