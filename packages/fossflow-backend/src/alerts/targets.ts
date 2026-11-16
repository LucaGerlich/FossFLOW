import { z } from 'zod';

/**
 * Identity patterns for alert targets. Keep in sync with
 * `packages/fossflow-lib/src/traffic/match.ts` (`matchesIdentity`) and
 * `packages/fossflow-lib/src/schemas/common.ts` (`trafficIdentity`).
 */
export const identityPattern = z
  .string()
  .min(1, 'Pattern is required')
  .max(300, 'Pattern is too long')
  // eslint-disable-next-line no-control-regex
  .regex(/^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$/, 'Use service:, host: or db: with an optional leading *.');

export const alertTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('arrow'), from: identityPattern, to: identityPattern }),
  z.object({ type: z.literal('box'), identity: identityPattern })
]);

const WILDCARD = ':*.';

/** An exact match always counts; `T:*.REST` matches `T:X.REST` for a non-empty `X`. */
export function matchesIdentity(pattern: string, id: string): boolean {
  if (pattern === id) return true;
  const at = pattern.indexOf(WILDCARD);
  if (at === -1) return false;
  const prefix = pattern.slice(0, at + 1);
  const suffix = pattern.slice(at + WILDCARD.length - 1);
  return id.startsWith(prefix) && id.length > prefix.length + suffix.length && id.endsWith(suffix);
}
