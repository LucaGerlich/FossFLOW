/**
 * Privacy scrubbing for ingested span data. Anything that reaches storage goes
 * through these helpers: member and customer identifiers must not survive.
 */

const DEFAULT_MAX = 300;

const ALL_DIGITS = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const DIGIT_RUN = /\d{5}/;
const LONG_TOKEN = /^[A-Za-z0-9_=.-]{20,}$/;
const HAS_DIGIT = /\d/;

export const cap = (value: string, max: number = DEFAULT_MAX): string =>
  value.length > max ? value.slice(0, max) : value;

const MAX_DECODE_ROUNDS = 3;
const LONG_PLAIN_TOKEN = /^[A-Za-z0-9_=-]{32,}$/;

/** Decodes until stable, so double-encoded values cannot hide an id. */
const decodeSegment = (segment: string): string => {
  let current = segment;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
};

const looksLikeId = (segment: string): boolean =>
  ALL_DIGITS.test(segment) ||
  UUID.test(segment) ||
  LONG_HEX.test(segment) ||
  segment.includes('@') ||
  DIGIT_RUN.test(segment) ||
  LONG_PLAIN_TOKEN.test(segment) ||
  (LONG_TOKEN.test(segment) && HAS_DIGIT.test(segment));

/** Replaces id-like path segments with `{id}` so one route is one operation. */
export const templatePath = (path: string): string =>
  path
    .split('/')
    .map((raw) => {
      // Matrix parameters (`;jsessionid=...`) are dropped.
      const segment = raw.split(';')[0] ?? '';
      return segment !== '' && looksLikeId(decodeSegment(segment))
        ? '{id}'
        : segment;
    })
    .join('/');
