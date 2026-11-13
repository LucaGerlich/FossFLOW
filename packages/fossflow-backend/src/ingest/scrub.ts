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

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

const looksLikeId = (segment: string): boolean =>
  ALL_DIGITS.test(segment) ||
  UUID.test(segment) ||
  LONG_HEX.test(segment) ||
  segment.includes('@') ||
  DIGIT_RUN.test(segment) ||
  (LONG_TOKEN.test(segment) && HAS_DIGIT.test(segment));

/** Replaces id-like path segments with `{id}` so one route is one operation. */
export const templatePath = (path: string): string =>
  path
    .split('/')
    .map((segment) =>
      segment !== '' && looksLikeId(decodeSegment(segment)) ? '{id}' : segment
    )
    .join('/');
