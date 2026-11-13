import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';
import { describe, it } from 'vitest';
import {
  decodeTraceRequest,
  formatOf,
  OtlpDecodeError
} from './otlp-decode.js';

const PROTO_DIR = fileURLToPath(new URL('../../proto', import.meta.url));

const fixtureResourceSpan = {
  resource: {
    attributes: [
      { key: 'service.name', value: { stringValue: 'member-app' } },
      { key: 'tags', value: { arrayValue: { values: [] } } }
    ]
  },
  scopeSpans: [
    {
      spans: [
        {
          traceId: '5b8efff798038103d269b633813fc60c',
          spanId: 'eee19b7ec3c1b174',
          name: 'GET /x',
          kind: 3,
          startTimeUnixNano: '1794577130744000000',
          endTimeUnixNano: '1794577130944000000',
          attributes: [
            { key: 'http.response.status_code', value: { intValue: '503' } }
          ],
          status: { code: 2 },
          futureField: 1
        }
      ]
    }
  ]
};

const jsonFixture = {
  resourceSpans: [fixtureResourceSpan]
};

const body = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

const encodeProtobuf = async (value: object): Promise<Buffer> => {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => join(PROTO_DIR, target);
  await root.load(
    'opentelemetry/proto/collector/trace/v1/trace_service.proto'
  );
  const type = root.lookupType(
    'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest'
  );
  return Buffer.from(type.encode(type.fromObject(value)).finish());
};

describe('decodeTraceRequest', () => {
  it('decodes OTLP JSON', () => {
    const result = decodeTraceRequest(body(jsonFixture), 'json');
    const span = result.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    assert.ok(span);
    assert.equal(span.startTimeUnixNano, 1794577130744000000n);
    assert.equal(span.kind, 3);
    assert.equal(span.status?.code, 2);
    assert.equal('futureField' in span, false);
    assert.equal(
      result.resourceSpans?.[0]?.resource?.attributes?.[0]?.value
        ?.stringValue,
      'member-app'
    );
  });

  it('protobuf and JSON agree', async () => {
    const proto = await encodeProtobuf({
      resourceSpans: [
        {
          resource: fixtureResourceSpan.resource,
          scopeSpans: fixtureResourceSpan.scopeSpans.map((s) => ({
            spans: s.spans.map(({ futureField: _f, ...rest }) => rest)
          }))
        }
      ]
    });
    const fromProto = decodeTraceRequest(proto, 'protobuf');
    const fromJson = decodeTraceRequest(body(jsonFixture), 'json');
    assert.deepEqual(fromProto, fromJson);
  });

  it('accepts int64 as numbers in JSON', () => {
    const result = decodeTraceRequest(
      body({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [{ startTimeUnixNano: 1000, endTimeUnixNano: 2000 }]
              }
            ]
          }
        ]
      }),
      'json'
    );
    const span = result.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    assert.equal(span?.startTimeUnixNano, 1000n);
    assert.equal(span?.endTimeUnixNano, 2000n);
  });

  it('empty request', () => {
    const result = decodeTraceRequest(body({}), 'json');
    assert.equal((result.resourceSpans ?? []).length, 0);
    const fromProto = decodeTraceRequest(Buffer.alloc(0), 'protobuf');
    assert.equal((fromProto.resourceSpans ?? []).length, 0);
  });

  it('rejects', () => {
    assert.throws(
      () => decodeTraceRequest(Buffer.from('not protobuf at all'), 'protobuf'),
      OtlpDecodeError
    );
    assert.throws(
      () => decodeTraceRequest(Buffer.from('{'), 'json'),
      OtlpDecodeError
    );
    assert.throws(
      () => decodeTraceRequest(body({ resourceSpans: 5 }), 'json'),
      OtlpDecodeError
    );
    assert.throws(
      () =>
        decodeTraceRequest(
          body({
            resourceSpans: [
              {
                scopeSpans: [{ spans: [{ endTimeUnixNano: '2' }] }]
              }
            ]
          }),
          'json'
        ),
      OtlpDecodeError
    );
  });
});

describe('formatOf', () => {
  it('reads the media type only', () => {
    assert.equal(formatOf('application/x-protobuf'), 'protobuf');
    assert.equal(formatOf('Application/JSON; charset=utf-8'), 'json');
    assert.equal(formatOf('text/plain'), null);
    assert.equal(formatOf(undefined), null);
  });
});
