import dns from 'node:dns';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';

export interface PostResult {
  /** True for a 2xx answer. */
  ok: boolean;
  status: number | null;
  retryAfterSeconds: number | null;
  error: 'timeout' | 'refused' | 'network' | null;
}

export interface OutboundDeps {
  request: typeof https.request;
  lookup: typeof dns.lookup;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const REFUSED = 'ERR_OUTBOUND_REFUSED';

const privateRanges = new net.BlockList();
const v4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];
for (const [network, prefix] of v4) privateRanges.addSubnet(network, prefix, 'ipv4');
privateRanges.addAddress('::', 'ipv6');
privateRanges.addAddress('::1', 'ipv6');
privateRanges.addSubnet('fc00::', 7, 'ipv6');
privateRanges.addSubnet('fe80::', 10, 'ipv6');
privateRanges.addSubnet('ff00::', 8, 'ipv6');

/** The IPv4 part of an IPv4-mapped IPv6 address, in dotted or hex form. */
function mappedIpv4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (dotted) return dotted[1] ?? null;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!hex) return null;
  const high = Number.parseInt(hex[1] ?? '', 16);
  const low = Number.parseInt(hex[2] ?? '', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Whether an address is outside every private, loopback, link-local and reserved range. */
export function isPublicAddress(address: string, family: 4 | 6): boolean {
  if (family === 6) {
    const mapped = mappedIpv4(address);
    if (mapped) return isPublicAddress(mapped, 4);
  }
  return !privateRanges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw.trim(), 10);
}

/**
 * Posts JSON over HTTPS. Redirects are never followed and the response body is
 * never read. Unless `allowPrivate`, the connection is refused when the host
 * resolves to a private address (checked at connect time, so DNS rebinding
 * cannot slip past a pre-check).
 */
export function postJson(
  url: URL,
  body: unknown,
  options: { allowPrivate: boolean; timeoutMs?: number },
  deps: OutboundDeps = { request: https.request, lookup: dns.lookup }
): Promise<PostResult> {
  const fail = (error: NonNullable<PostResult['error']>): PostResult => ({
    ok: false,
    status: null,
    retryAfterSeconds: null,
    error
  });
  if (url.protocol !== 'https:') return Promise.resolve(fail('refused'));
  // IP-literal hosts skip the DNS lookup hook, so they are checked up front.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(literal);
  if (
    !options.allowPrivate &&
    literalFamily !== 0 &&
    !isPublicAddress(literal, literalFamily === 6 ? 6 : 4)
  ) {
    return Promise.resolve(fail('refused'));
  }

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result: PostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const lookup = (
      hostname: string,
      lookupOptions: dns.LookupOptions,
      callback: (error: Error | null, address: string | dns.LookupAddress[], family?: number) => void
    ) => {
      deps.lookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
        if (error) return callback(error, []);
        const blocked =
          !options.allowPrivate &&
          addresses.some((entry) => !isPublicAddress(entry.address, entry.family === 6 ? 6 : 4));
        if (blocked) {
          return callback(Object.assign(new Error('Address not allowed'), { code: REFUSED }), []);
        }
        const first = addresses[0];
        if (lookupOptions.all) return callback(null, addresses);
        if (!first) return callback(new Error('No address'), []);
        callback(null, first.address, first.family);
      });
    };

    const payload = JSON.stringify(body);
    const req = deps.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        },
        lookup: lookup as net.LookupFunction
      },
      (res: IncomingMessage) => {
        res.resume();
        const status = res.statusCode ?? 0;
        finish({
          ok: status >= 200 && status < 300,
          status,
          retryAfterSeconds: parseRetryAfter(res.headers['retry-after']),
          error: null
        });
      }
    );
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      finish(fail('timeout'));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    req.on('error', (error: NodeJS.ErrnoException) => {
      if (timedOut) return finish(fail('timeout'));
      finish(fail(error.code === REFUSED ? 'refused' : 'network'));
    });
    req.end(payload);
  });
}

/** Parses an https URL without user info; null when it is neither. */
export function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Injection token for the HTTPS poster, so tests can stand in for the network. */
export const POST_JSON = Symbol('POST_JSON');
