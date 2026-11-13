import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type {
  OtlpKeyValue,
  OtlpSpan,
  OtlpTraceRequest
} from './otlp-decode.js';
import { toTraffic } from './spans.js';

const NS = 1_000_000n;
const kv = (attrs: Record<string, string>): OtlpKeyValue[] =>
  Object.entries(attrs).map(([key, value]) => ({
    key,
    value: { stringValue: value }
  }));

const span = (
  kind: number,
  attrs: Record<string, string>,
  extra: Partial<OtlpSpan> = {}
): OtlpSpan => ({
  kind,
  startTimeUnixNano: 1_700_000_000_000n * NS,
  endTimeUnixNano: 1_700_000_000_050n * NS,
  attributes: kv(attrs),
  ...extra
});

const request = (
  serviceName: string | undefined,
  spans: OtlpSpan[]
): OtlpTraceRequest => ({
  resourceSpans: [
    {
      resource:
        serviceName === undefined
          ? undefined
          : { attributes: kv({ 'service.name': serviceName }) },
      scopeSpans: [{ spans }]
    }
  ]
});

const RECEIVED = 1_700_000_100_000;

const only = (req: OtlpTraceRequest) => {
  const batch = toTraffic(req, RECEIVED);
  assert.equal(batch.events.length, 1);
  return batch.events[0]!;
};

describe('toTraffic', () => {
  it('new and old HTTP names give the same event', () => {
    const next = only(
      request('member-app', [
        span(3, {
          'http.request.method': 'get',
          'url.full':
            'https://API.Magicline.com./v1/customers/42?email=jane@example.com#x',
          'server.address': 'API.Magicline.com.'
        })
      ])
    );
    const old = only(
      request('member-app', [
        span(3, {
          'http.method': 'GET',
          'http.url':
            'https://API.Magicline.com./v1/customers/42?email=jane@example.com#x',
          'net.peer.name': 'API.Magicline.com.'
        })
      ])
    );
    for (const event of [next, old]) {
      assert.equal(event.kind, 'call');
      assert.equal(event.caller, 'service:member-app');
      assert.equal(event.callee, 'host:api.magicline.com');
      assert.equal(event.operation, 'GET /v1/customers/{id}');
      for (const text of [event.callee, event.operation]) {
        assert.doesNotMatch(text, /jane|42|email|#/);
      }
    }
  });

  it('takes the callee host from the URL when no peer name is set', () => {
    const event = only(
      request('a', [
        span(3, {
          'http.request.method': 'GET',
          'url.full': 'https://User:pw@Host.Example:8443/x'
        })
      ])
    );
    assert.equal(event.callee, 'host:host.example');
  });

  it('cuts an unparsable URL at ? and #', () => {
    const event = only(
      request('a', [
        span(3, {
          'http.request.method': 'GET',
          'server.address': 'h',
          'http.url': 'not a url/v1/items/77?token=abc#frag'
        })
      ])
    );
    assert.doesNotMatch(event.operation, /token|frag|\?|#/);
  });

  it('new and old DB names give the same event', () => {
    const next = only(
      request('member-app', [
        span(3, {
          'db.system.name': 'postgresql',
          'server.address': 'members.db.internal',
          'db.namespace': 'members',
          'db.operation.name': 'SELECT',
          'db.collection.name': 'members',
          'db.query.text':
            "SELECT * FROM members WHERE email='jane@example.com'"
        })
      ])
    );
    const old = only(
      request('member-app', [
        span(3, {
          'db.system': 'postgresql',
          'net.peer.name': 'members.db.internal',
          'db.name': 'members',
          'db.operation': 'SELECT',
          'db.sql.table': 'members',
          'db.statement': "SELECT * FROM members WHERE email='jane@example.com'"
        })
      ])
    );
    for (const event of [next, old]) {
      assert.equal(event.callee, 'db:members.db.internal/members');
      assert.equal(event.operation, 'SELECT members');
      assert.equal(event.kind, 'call');
    }
  });

  it('falls back to the DB system when there is no peer name', () => {
    const event = only(
      request('a', [span(3, { 'db.system': 'redis', 'db.operation': 'GET' })])
    );
    assert.equal(event.callee, 'db:redis');
    assert.equal(event.operation, 'GET');
  });

  it('DB operation fallbacks', () => {
    const db = { 'db.system': 'postgresql', 'net.peer.name': 'db' };
    const batch = toTraffic(
      request('a', [
        span(
          3,
          { ...db, 'db.query.summary': 'SELECT members' },
          {
            name: 'SELECT * FROM members WHERE email=1'
          }
        ),
        span(3, db, { name: 'pg.query:SELECT members' }),
        span(3, db, {
          name: "SELECT * FROM members WHERE email='jane@example.com'"
        })
      ]),
      RECEIVED
    );
    assert.deepEqual(
      batch.events.map((event) => event.operation),
      ['SELECT members', 'pg.query:SELECT members', 'query']
    );
    assert.doesNotMatch(JSON.stringify(batch), /WHERE/);
  });

  it('failures', () => {
    const http = { 'http.request.method': 'GET', 'server.address': 'h' };
    const error = { code: 2 };
    const batch = toTraffic(
      request('a', [
        span(
          3,
          { ...http, 'http.response.status_code': '503' },
          { status: error }
        ),
        span(3, { ...http, 'error.type': 'timeout' }, { status: error }),
        span(
          3,
          { ...http, 'error.type': 'Error: user jane@example.com not found' },
          { status: error }
        ),
        span(3, http, { status: { code: 1 } })
      ]),
      RECEIVED
    );
    assert.deepEqual(
      batch.events.map((event) => [event.failed, event.status]),
      [
        [true, '503'],
        [true, 'timeout'],
        [true, 'error'],
        [false, null]
      ]
    );
  });

  it('incoming', () => {
    const batch = toTraffic(
      request('member-app', [
        span(2, {
          'http.route': '/api/members/:id',
          'http.request.method': 'GET',
          'server.address': 'Member-App.internal:8080'
        })
      ]),
      RECEIVED
    );
    const event = batch.events[0]!;
    assert.equal(event.kind, 'incoming');
    assert.equal(event.caller, '');
    assert.equal(event.callee, 'service:member-app');
    assert.equal(event.operation, 'GET /api/members/:id');
    assert.deepEqual(batch.aliases, [
      { host: 'member-app.internal', service: 'member-app' }
    ]);
    assert.deepEqual(batch.services, ['member-app']);
  });

  it('templates the path of an incoming span without a route', () => {
    const event = only(
      request('a', [
        span(2, {
          'http.method': 'GET',
          'http.target': '/v1/customers/12345?x=1'
        })
      ])
    );
    assert.equal(event.operation, 'GET /v1/customers/{id}');
  });

  it('keeps bare IPv6 alias hosts and strips ports from bracketed ones', () => {
    const batch = toTraffic(
      request('a', [
        span(2, { 'server.address': '[::1]:3000' }),
        span(2, { 'server.address': 'fe80::1' })
      ]),
      RECEIVED
    );
    assert.deepEqual(
      batch.aliases.map((alias) => alias.host),
      ['[::1]', 'fe80::1']
    );
  });

  it('defaults the service name', () => {
    const batch = toTraffic(
      request(undefined, [
        span(3, { 'http.request.method': 'GET', 'server.address': 'h' })
      ]),
      RECEIVED
    );
    assert.equal(batch.events[0]!.caller, 'service:unknown_service');
    assert.deepEqual(batch.services, ['unknown_service']);
  });

  it('ignores INTERNAL, PRODUCER and CONSUMER spans, and calls without a host', () => {
    const http = { 'http.request.method': 'GET', 'server.address': 'h' };
    const batch = toTraffic(
      request('a', [
        span(1, http),
        span(4, http),
        span(5, http),
        span(3, { 'http.request.method': 'GET' })
      ]),
      RECEIVED
    );
    assert.deepEqual(batch.events, []);
  });

  it('anchors a batch on the server clock', () => {
    const threeHours = 3 * 3_600_000;
    const start1 = (RECEIVED - threeHours) * 1;
    const start2 = start1 + 2_000;
    const http = { 'http.request.method': 'GET', 'server.address': 'h' };
    const batch = toTraffic(
      request('a', [
        span(3, http, {
          startTimeUnixNano: BigInt(start1) * NS,
          endTimeUnixNano: BigInt(start1 + 100) * NS
        }),
        span(3, http, {
          startTimeUnixNano: BigInt(start2) * NS,
          endTimeUnixNano: BigInt(start2 + 100) * NS
        })
      ]),
      RECEIVED
    );
    const [first, second] = batch.events;
    assert.equal(second!.at - first!.at, 2_000);
    for (const event of batch.events) {
      assert.ok(event.at >= RECEIVED - 2_200 && event.at <= RECEIVED);
      assert.equal(event.durationMs, 100);
    }
  });

  it('never reports a negative duration', () => {
    const event = only(
      request('a', [
        span(
          3,
          { 'http.request.method': 'GET', 'server.address': 'h' },
          {
            startTimeUnixNano: 10n * NS,
            endTimeUnixNano: 5n * NS
          }
        )
      ])
    );
    assert.equal(event.durationMs, 0);
  });

  it('templates and cuts an incoming http.route', () => {
    const event = only(
      request('a', [
        span(2, {
          'http.request.method': 'GET',
          'http.route': '/api/members/12345?x=1'
        })
      ])
    );
    assert.equal(event.operation, 'GET /api/members/{id}');
    const kept = only(
      request('a', [
        span(2, {
          'http.request.method': 'GET',
          'http.route': '/api/members/[id]'
        })
      ])
    );
    assert.equal(kept.operation, 'GET /api/members/[id]');
  });

  it('rejects an unsafe db.query.summary and falls through', () => {
    const db = { 'db.system': 'postgresql', 'net.peer.name': 'db' };
    const event = only(
      request('a', [
        span(3, {
          ...db,
          'db.query.summary':
            "SELECT * FROM members WHERE email='jane@example.com'"
        })
      ])
    );
    assert.equal(event.operation, 'query');
  });

  it('does not accept a numeric second word in a DB span name', () => {
    const event = only(
      request('a', [
        span(
          3,
          { 'db.system': 'postgresql', 'net.peer.name': 'db' },
          {
            name: 'SELECT 4711'
          }
        )
      ])
    );
    assert.equal(event.operation, 'query');
  });

  it('normalises DB hosts and drops unsafe namespaces', () => {
    const base = {
      'db.system': 'postgresql',
      'net.peer.name': 'Members.DB.internal:5432'
    };
    assert.equal(
      only(request('a', [span(3, { ...base, 'db.name': 'members' })])).callee,
      'db:members.db.internal/members'
    );
    assert.equal(
      only(request('a', [span(3, { ...base, 'db.name': "x' OR 1=1" })])).callee,
      'db:members.db.internal'
    );
  });

  it('drops calls and aliases whose host is not a plain hostname', () => {
    const bad = request('a', [
      span(3, {
        'http.request.method': 'GET',
        'server.address': 'evil/path?x=1'
      }),
      span(3, { 'db.system': 'postgresql', 'net.peer.name': 'a b' }),
      span(2, { 'server.address': 'evil/path?x=1' })
    ]);
    const batch = toTraffic(bad, RECEIVED);
    assert.equal(batch.events.filter((e) => e.kind === 'call').length, 0);
    assert.deepEqual(batch.aliases, []);
  });

  it('only keeps a three-digit http status code', () => {
    const http = { 'http.request.method': 'GET', 'server.address': 'h' };
    const error = { code: 2 };
    const intStatus: OtlpSpan = {
      ...span(3, http, { status: error }),
      attributes: [
        ...kv(http),
        { key: 'http.response.status_code', value: { intValue: 503 } }
      ]
    };
    const batch = toTraffic(
      request('a', [
        intStatus,
        span(
          3,
          {
            ...http,
            'http.response.status_code': 'user jane@example.com not found'
          },
          { status: error }
        ),
        span(
          3,
          {
            ...http,
            'http.response.status_code': 'user jane@example.com not found',
            'error.type': 'timeout'
          },
          { status: error }
        )
      ]),
      RECEIVED
    );
    assert.deepEqual(
      batch.events.map((e) => e.status),
      ['503', 'error', 'timeout']
    );
  });

  it('keeps ids out of DB operations and namespaces', () => {
    const longName = `${'ab.'.repeat(21)}a`;
    const db = { 'db.system': 'postgresql', 'net.peer.name': 'db' };
    const summary = only(
      request('a', [
        span(3, { ...db, 'db.query.summary': 'SELECT members 4711' })
      ])
    );
    assert.doesNotMatch(summary.operation, /4711/);
    const collection = only(
      request('a', [
        span(3, {
          ...db,
          'db.operation.name': 'SELECT',
          'db.collection.name': 'orders_123456'
        })
      ])
    );
    assert.equal(collection.operation, 'SELECT {id}');
    assert.equal(
      only(request('a', [span(3, { ...db, 'db.name': 'shop_48213' })])).callee,
      'db:db/{id}'
    );
    assert.equal(
      only(request('a', [span(3, { ...db, 'db.name': 'n'.repeat(65) })]))
        .callee,
      'db:db'
    );
    assert.equal(
      only(request('a', [span(3, { ...db, 'db.name': longName })])).callee,
      `db:db/${longName}`
    );
  });

  it('caps identities at 300 characters', () => {
    const event = only(
      request('s'.repeat(400), [
        span(3, {
          'http.request.method': 'GET',
          'server.address': 'h'.repeat(250)
        })
      ])
    );
    assert.equal(event.caller.length, 300);
    assert.equal(event.callee.length, 255);
    const tooLong = toTraffic(
      request('a', [
        span(3, {
          'http.request.method': 'GET',
          'server.address': 'h'.repeat(400)
        })
      ]),
      RECEIVED
    );
    assert.deepEqual(tooLong.events, []);
  });
});
