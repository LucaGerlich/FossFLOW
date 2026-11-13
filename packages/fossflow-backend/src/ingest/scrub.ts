/**
 * Privacy scrubbing for ingested span data. Anything that reaches storage goes
 * through these helpers: member and customer identifiers must not survive.
 */

/** Postgres rejects NUL and caps btree entries, so text is cut by bytes, not UTF-16 units. */
const DEFAULT_MAX_BYTES = 300;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

const ALL_DIGITS = /^\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;
const DIGIT_RUN = /\d{5}/;
const LONG_TOKEN = /^[A-Za-z0-9_=.-]{20,}$/;
const HAS_DIGIT = /\d/;

/**
 * Removes control characters, then cuts to at most `max` UTF-8 bytes without
 * splitting a code point.
 */
export const cap = (value: string, max: number = DEFAULT_MAX_BYTES): string => {
  const clean = value.replace(CONTROL_CHARACTERS, '');
  if (Buffer.byteLength(clean) <= max) return clean;
  let bytes = 0;
  let result = '';
  for (const character of clean) {
    bytes += Buffer.byteLength(character);
    if (bytes > max) break;
    result += character;
  }
  return result;
};

const MAX_DECODE_ROUNDS = 3;
const LONG_PLAIN_TOKEN = /^[A-Za-z0-9_=-]{32,}$/;

/**
 * Decodes until stable, so multi-encoded values cannot hide an id. Returns
 * null when the value still changes after the last round.
 */
const decodeSegment = (segment: string): string | null => {
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
  try {
    return decodeURIComponent(current) === current ? current : null;
  } catch {
    return current;
  }
};

export const looksLikeId = (segment: string): boolean =>
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
      if (segment === '') return segment;
      const decoded = decodeSegment(segment);
      return decoded === null || looksLikeId(decoded) ? '{id}' : segment;
    })
    .join('/');
