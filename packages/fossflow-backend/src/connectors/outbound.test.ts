import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, it, vi } from 'vitest';
import { isPublicAddress, postJson, type OutboundDeps } from './outbound.js';

describe('isPublicAddress', () => {
  const table: Array<[string, 4 | 6, boolean]> = [
    ['8.8.8.8', 4, true],
    ['127.0.0.1', 4, false],
    ['10.0.0.5', 4, false],
    ['169.254.169.254', 4, false],
    ['172.31.0.1', 4, false],
    ['172.32.0.1', 4, true],
    ['192.168.1.1', 4, false],
    ['100.64.0.1', 4, false],
    ['0.0.0.0', 4, false],
    ['224.0.0.1', 4, false],
    ['255.255.255.255', 4, false],
    ['::1', 6, false],
    ['::', 6, false],
    ['fe80::1', 6, false],
    ['fd00::1', 6, false],
    ['ff02::1', 6, false],
    ['::ffff:10.0.0.1', 6, false],
    ['::ffff:a00:1', 6, false],
    ['::ffff:8.8.8.8', 6, true],
    ['2606:4700::1111', 6, true]
  ];
  for (const [address, family, expected] of table) {
    it(`${address} -> ${expected}`, () => {
      assert.equal(isPublicAddress(address, family), expected);
    });
  }
});

type LookupHook = (
  hostname: string,
  options: { all?: boolean },
  callback: (error: Error | null, address?: unknown, family?: number) => void
) => void;

class FakeRequest extends EventEmitter {
  written = '';
  headers: Record<string, unknown> = {};
  destroyed = false;
  write(chunk: string) {
    this.written += chunk;
    return true;
  }
  end(chunk?: string) {
    if (chunk) this.written += chunk;
  }
  destroy(error?: Error) {
    this.destroyed = true;
    if (error) this.emit('error', error);
    return this;
  }
}

type Reply = { statusCode: number; headers: Record<string, string> };

function harness(options: {
  addresses?: LookupAddress[];
  reply?: Reply | null;
}) {
  const requests: FakeRequest[] = [];
  const connected: string[] = [];
  const deps: OutboundDeps = {
    lookup: ((hostname: string, _options: unknown, callback: (e: null, a: LookupAddress[]) => void) => {
      callback(null, options.addresses ?? [{ address: '8.8.8.8', family: 4 }]);
    }) as unknown as OutboundDeps['lookup'],
    request: ((url: URL, requestOptions: { lookup?: LookupHook; headers?: Record<string, unknown> }, callback: (res: unknown) => void) => {
      const req = new FakeRequest();
      req.headers = requestOptions.headers ?? {};
      requests.push(req);
      queueMicrotask(() => {
        requestOptions.lookup?.(url.hostname, { all: true }, (error, addresses) => {
          if (error) {
            req.emit('error', error);
            return;
          }
          connected.push(JSON.stringify(addresses));
          if (options.reply) {
            callback(
              Object.assign(new EventEmitter(), {
                statusCode: options.reply.statusCode,
                headers: options.reply.headers,
                resume: () => {}
              })
            );
          }
        });
      });
      return req;
    }) as unknown as OutboundDeps['request']
  };
  return { deps, requests, connected };
}

const url = new URL('https://hooks.example.com/x?secret=1');

afterEach(() => {
  vi.useRealTimers();
});

describe('postJson', () => {
  it('posts JSON and reports a 2xx as ok', async () => {
    const { deps, requests } = harness({ reply: { statusCode: 200, headers: {} } });
    const result = await postJson(url, { a: 1 }, { allowPrivate: false }, deps);
    assert.deepEqual(result, { ok: true, status: 200, retryAfterSeconds: null, error: null });
    assert.equal(requests[0]?.written, '{"a":1}');
    assert.equal(requests[0]?.headers['content-type'], 'application/json');
  });

  it('refuses private addresses at connect time', async () => {
    const { deps, connected } = harness({
      addresses: [{ address: '10.0.0.5', family: 4 }],
      reply: { statusCode: 200, headers: {} }
    });
    const result = await postJson(url, {}, { allowPrivate: false }, deps);
    assert.deepEqual(result, { ok: false, status: null, retryAfterSeconds: null, error: 'refused' });
    assert.equal(connected.length, 0);
  });

  it('refuses when any resolved address is private', async () => {
    const { deps } = harness({
      addresses: [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ]
    });
    const result = await postJson(url, {}, { allowPrivate: false }, deps);
    assert.equal(result.error, 'refused');
  });

  it('connects to private addresses when allowed', async () => {
    const { deps, connected } = harness({
      addresses: [{ address: '10.0.0.5', family: 4 }],
      reply: { statusCode: 204, headers: {} }
    });
    const result = await postJson(url, {}, { allowPrivate: true }, deps);
    assert.equal(result.ok, true);
    assert.equal(connected.length, 1);
  });

  it('does not follow redirects', async () => {
    const { deps, requests } = harness({
      reply: { statusCode: 302, headers: { location: 'https://evil.example/' } }
    });
    const result = await postJson(url, {}, { allowPrivate: false }, deps);
    assert.deepEqual(result, { ok: false, status: 302, retryAfterSeconds: null, error: null });
    assert.equal(requests.length, 1);
  });

  it('refuses http URLs without a request', async () => {
    const { deps, requests } = harness({ reply: { statusCode: 200, headers: {} } });
    const result = await postJson(new URL('http://hooks.example.com/'), {}, { allowPrivate: true }, deps);
    assert.equal(result.error, 'refused');
    assert.equal(requests.length, 0);
  });

  it('parses retry-after as seconds', async () => {
    const { deps } = harness({ reply: { statusCode: 429, headers: { 'retry-after': '30' } } });
    const result = await postJson(url, {}, { allowPrivate: false }, deps);
    assert.deepEqual(result, { ok: false, status: 429, retryAfterSeconds: 30, error: null });
  });

  it('ignores an unparseable retry-after', async () => {
    const { deps } = harness({ reply: { statusCode: 429, headers: { 'retry-after': 'soon' } } });
    const result = await postJson(url, {}, { allowPrivate: false }, deps);
    assert.equal(result.retryAfterSeconds, null);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const { deps, requests } = harness({ reply: null });
    const pending = postJson(url, {}, { allowPrivate: false, timeoutMs: 10_000 }, deps);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    assert.deepEqual(result, { ok: false, status: null, retryAfterSeconds: null, error: 'timeout' });
    assert.equal(requests[0]?.destroyed, true);
  });

  it('reports other failures as network', async () => {
    const { deps, requests } = harness({ reply: null });
    const pending = postJson(url, {}, { allowPrivate: false }, deps);
    await Promise.resolve();
    requests[0]?.emit('error', new Error('ECONNRESET'));
    assert.equal((await pending).error, 'network');
  });
});
