import type {
  OtlpKeyValue,
  OtlpSpan,
  OtlpTraceRequest
} from './otlp-decode.js';
import { cap, templatePath } from './scrub.js';

export type TrafficEvent = {
  kind: 'call' | 'incoming';
  /** `service:<name>`, or `''` for incoming events. */
  caller: string;
  callee: string;
  operation: string;
  /** Milliseconds on the server clock. */
  at: number;
  durationMs: number;
  failed: boolean;
  /** Set only when `failed`. */
  status: string | null;
};

export type TrafficBatch = {
  events: TrafficEvent[];
  services: string[];
  aliases: { host: string; service: string }[];
};

const SPAN_KIND_SERVER = 2;
const SPAN_KIND_CLIENT = 3;
const STATUS_CODE_ERROR = 2;
const MAX_AGE_MS = 3_600_000;
const MAX_SPAN_NAME = 60;
const METHOD = /^[A-Z]{1,10}$/;
const ERROR_TYPE = /^[\w.:-]{1,60}$/;
const SPAN_NAME_OPERATION = /^[A-Za-z][\w.:-]*( [A-Za-z_][\w.]*)?$/;
const QUERY_SUMMARY = /^[A-Za-z][\w.$:-]*( [\w.$:-]+){0,5}$/;
const MAX_QUERY_SUMMARY = 100;
const SAFE_HOST = /^[a-z0-9._:[\]-]{1,253}$/;
const SAFE_NAMESPACE = /^[\w.$|-]{1,128}$/;
const HTTP_STATUS = /^\d{3}$/;
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

type Attributes = ReadonlyMap<string, string>;

const toAttributes = (list: OtlpKeyValue[] | undefined): Attributes => {
  const map = new Map<string, string>();
  for (const { key, value } of list ?? []) {
    if (value?.stringValue !== undefined) map.set(key, value.stringValue);
    else if (value?.intValue !== undefined)
      map.set(key, String(value.intValue));
  }
  return map;
};

/** First non-empty value among the candidate attribute names. */
const pick = (
  attributes: Attributes,
  ...names: string[]
): string | undefined => {
  for (const name of names) {
    const value = attributes.get(name);
    if (value) return value;
  }
  return undefined;
};

/** Lower-cases and drops a trailing `:port`, but keeps a bare IPv6 address. */
const stripPort = (host: string): string => {
  const lower = host.trim().toLowerCase();
  if (lower.startsWith('[')) return lower.replace(/\]:\d+$/, ']');
  if (lower.split(':').length > 2) return lower;
  return lower.replace(/:\d+$/, '');
};

/** Normalised host, or undefined when it is not a plain hostname. */
const cleanHost = (raw: string): string | undefined => {
  const host = stripPort(raw).replace(/\.$/, '');
  return SAFE_HOST.test(host) ? host : undefined;
};

const parseUrl = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};

const urlOf = (attributes: Attributes): string | undefined =>
  pick(attributes, 'url.full', 'http.url');

const httpHost = (attributes: Attributes): string | undefined => {
  const explicit = pick(attributes, 'server.address', 'net.peer.name');
  const raw = explicit ?? parseUrl(urlOf(attributes) ?? '')?.hostname;
  return raw ? cleanHost(raw) : undefined;
};

const dbCallee = (attributes: Attributes): string | undefined => {
  const system = pick(attributes, 'db.system.name', 'db.system');
  const target = pick(attributes, 'server.address', 'net.peer.name') ?? system;
  const host = target ? cleanHost(target) : undefined;
  if (!host) return undefined;
  const namespace = pick(attributes, 'db.namespace', 'db.name');
  const safe = namespace && SAFE_NAMESPACE.test(namespace) ? namespace : '';
  return `db:${host}${safe ? `/${safe}` : ''}`;
};

const pathOfUrl = (raw: string): string => {
  const parsed = parseUrl(raw);
  if (parsed) return parsed.pathname;
  return raw.replace(URL_PREFIX, '').split(/[?#]/)[0] ?? '';
};

const methodOf = (attributes: Attributes): string => {
  const upper = (
    pick(attributes, 'http.request.method', 'http.method') ?? ''
  ).toUpperCase();
  return METHOD.test(upper) ? upper : 'HTTP';
};

const joinOperation = (method: string, path: string): string =>
  path === '' ? method : `${method} ${path}`;

const httpOperation = (attributes: Attributes): string => {
  const url = urlOf(attributes);
  return joinOperation(
    methodOf(attributes),
    url ? templatePath(pathOfUrl(url)) : ''
  );
};

const incomingOperation = (attributes: Attributes): string => {
  const route = pick(attributes, 'http.route');
  const cleanRoute = route ? (route.split(/[?#]/)[0] ?? '') : '';
  if (cleanRoute) {
    return joinOperation(methodOf(attributes), templatePath(cleanRoute));
  }
  const target = pick(attributes, 'url.path', 'http.target');
  const path = target ? (target.split(/[?#]/)[0] ?? '') : '';
  return joinOperation(methodOf(attributes), templatePath(path));
};

const dbOperation = (
  attributes: Attributes,
  name: string | undefined
): string => {
  const summary = pick(attributes, 'db.query.summary');
  if (
    summary &&
    summary.length <= MAX_QUERY_SUMMARY &&
    QUERY_SUMMARY.test(summary)
  ) {
    return summary;
  }
  const operation = pick(attributes, 'db.operation.name', 'db.operation');
  if (operation) {
    const collection = pick(
      attributes,
      'db.collection.name',
      'db.sql.table',
      'db.mongodb.collection'
    );
    return collection ? `${operation} ${collection}` : operation;
  }
  if (name && name.length <= MAX_SPAN_NAME && SPAN_NAME_OPERATION.test(name)) {
    return name;
  }
  return 'query';
};

const failureStatus = (attributes: Attributes): string => {
  for (const name of ['http.response.status_code', 'http.status_code']) {
    const code = attributes.get(name);
    if (code && HTTP_STATUS.test(code)) return code;
  }
  const type = pick(attributes, 'error.type');
  return type && ERROR_TYPE.test(type) ? type : 'error';
};

const aliasOf = (
  attributes: Attributes,
  service: string
): { host: string; service: string } | null => {
  const raw = pick(attributes, 'server.address', 'net.host.name', 'http.host');
  const host = raw ? cleanHost(raw) : undefined;
  return host ? { host: cap(host), service } : null;
};

type Mapped = { callee: string; operation: string } | null;

const mapCall = (span: OtlpSpan, attributes: Attributes): Mapped => {
  if (pick(attributes, 'db.system.name', 'db.system')) {
    const callee = dbCallee(attributes);
    return callee
      ? { callee, operation: dbOperation(attributes, span.name) }
      : null;
  }
  if (pick(attributes, 'http.request.method', 'http.method')) {
    const host = httpHost(attributes);
    return host
      ? { callee: `host:${host}`, operation: httpOperation(attributes) }
      : null;
  }
  return null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Maps a decoded OTLP request to scrubbed traffic. Span clocks belong to the
 * sender, so a batch is anchored on the server clock: its latest span end is
 * taken to be `receivedAt`, and every span keeps its offset from that end.
 */
export const toTraffic = (
  request: OtlpTraceRequest,
  receivedAt: number
): TrafficBatch => {
  const resources = request.resourceSpans ?? [];
  let latestEnd = 0n;
  for (const resource of resources) {
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        if (span.endTimeUnixNano > latestEnd) latestEnd = span.endTimeUnixNano;
      }
    }
  }

  const events: TrafficEvent[] = [];
  const services = new Set<string>();
  const aliases = new Map<string, { host: string; service: string }>();

  for (const resource of resources) {
    const name = pick(
      toAttributes(resource.resource?.attributes),
      'service.name'
    );
    const service = cap(name ?? 'unknown_service');
    services.add(service);

    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        const attributes = toAttributes(span.attributes);
        let kind: TrafficEvent['kind'];
        let callee: string;
        let operation: string;

        if (span.kind === SPAN_KIND_CLIENT) {
          const call = mapCall(span, attributes);
          if (!call) continue;
          kind = 'call';
          ({ callee, operation } = call);
        } else if (span.kind === SPAN_KIND_SERVER) {
          kind = 'incoming';
          callee = `service:${service}`;
          operation = incomingOperation(attributes);
          const alias = aliasOf(attributes, service);
          if (alias) aliases.set(`${alias.host}\n${alias.service}`, alias);
        } else {
          continue;
        }

        const failed = span.status?.code === STATUS_CODE_ERROR;
        events.push({
          kind,
          caller: kind === 'call' ? cap(`service:${service}`) : '',
          callee: cap(callee),
          operation: cap(operation),
          at: clamp(
            receivedAt - Number(latestEnd - span.startTimeUnixNano) / 1e6,
            receivedAt - MAX_AGE_MS,
            receivedAt
          ),
          durationMs: Math.max(
            0,
            Number(span.endTimeUnixNano - span.startTimeUnixNano) / 1e6
          ),
          failed,
          status: failed ? failureStatus(attributes) : null
        });
      }
    }
  }

  return {
    events,
    services: [...services],
    aliases: [...aliases.values()]
  };
};
