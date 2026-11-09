import { readFileSync } from 'node:fs';
import { z } from 'zod';

export interface BeszelConfig {
  /** Hub base URL without trailing slash, e.g. `https://beszel.example.com`. */
  url: string;
  email: string;
  password: string;
}

export interface LiveConfig {
  pollSeconds: number;
  beszel: BeszelConfig;
}

/**
 * `reason: null` means live data is simply not configured (no BESZEL_URL),
 * which is the normal state for plain diagramming and must not log noise.
 */
export type LiveConfigResult =
  | { ok: true; config: LiveConfig }
  | { ok: false; reason: string | null };

const DEFAULT_POLL_SECONDS = 30;

const pollSchema = z.coerce.number().int().min(10).max(3600);

type UrlResult = { ok: true; url: string } | { ok: false; problem: string };

function parseSourceUrl(value: string): UrlResult {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, problem: 'is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, problem: 'must use http or https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, problem: 'must not contain credentials' };
  }
  // Keep a sub-path (hub behind a reverse proxy) but drop query, hash and trailing slash.
  return {
    ok: true,
    url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  };
}

function readPassword(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string
): string | null {
  if (env.BESZEL_PASSWORD) return env.BESZEL_PASSWORD;
  if (!env.BESZEL_PASSWORD_FILE) return null;
  try {
    return readFile(env.BESZEL_PASSWORD_FILE).replace(/\r?\n$/, '');
  } catch {
    return null;
  }
}

/**
 * Reads and validates live-data settings from the environment.
 * Reasons never contain secret values.
 */
export function readLiveConfig(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')
): LiveConfigResult {
  if (!env.BESZEL_URL) return { ok: false, reason: null };

  const url = parseSourceUrl(env.BESZEL_URL);
  if (!url.ok) return { ok: false, reason: `BESZEL_URL ${url.problem}` };

  const email = env.BESZEL_EMAIL?.trim();
  if (!email) return { ok: false, reason: 'BESZEL_EMAIL is not set' };

  const password = readPassword(env, readFile);
  if (!password) {
    return {
      ok: false,
      reason: env.BESZEL_PASSWORD_FILE
        ? 'BESZEL_PASSWORD_FILE could not be read'
        : 'BESZEL_PASSWORD or BESZEL_PASSWORD_FILE is not set'
    };
  }

  let pollSeconds = DEFAULT_POLL_SECONDS;
  if (env.LIVE_POLL_SECONDS) {
    const poll = pollSchema.safeParse(env.LIVE_POLL_SECONDS);
    if (!poll.success) {
      return {
        ok: false,
        reason: 'LIVE_POLL_SECONDS must be an integer between 10 and 3600'
      };
    }
    pollSeconds = poll.data;
  }

  return {
    ok: true,
    config: {
      pollSeconds,
      beszel: { url: url.url, email, password }
    }
  };
}
