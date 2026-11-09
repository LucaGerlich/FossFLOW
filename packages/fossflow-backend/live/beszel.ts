import { z } from 'zod';
import type { BeszelConfig } from './config.ts';

/**
 * Minimal read-only client for the Beszel hub (PocketBase REST API).
 * Use a Beszel user with the `readonly` role: it can list the systems it is
 * a member of plus their containers, and cannot change anything.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

const finite = z.number().finite();

export const beszelSystemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.string(),
  info: z
    .object({
      cpu: finite.optional(),
      mp: finite.optional(),
      dp: finite.optional(),
      bb: finite.optional(),
      b: finite.optional(),
      la: z.array(finite).length(3).optional(),
      u: finite.optional(),
      dt: finite.optional()
    })
    .passthrough()
    .nullish()
});

export const beszelContainerSchema = z.object({
  system: z.string().min(1),
  name: z.string().min(1),
  image: z.string().default(''),
  status: z.string().default(''),
  health: z.number().int().default(0),
  cpu: finite.default(0),
  memory: finite.default(0),
  updatable: z.boolean().optional(),
  /** Last report for this container: Beszel stores Unix ms; tolerate a date string too. */
  updated: z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => {
      const ms = typeof value === 'string' ? Date.parse(value) : value;
      return ms !== undefined && Number.isFinite(ms) ? ms : undefined;
    })
});

export type BeszelSystem = z.infer<typeof beszelSystemSchema>;
export type BeszelContainer = z.infer<typeof beszelContainerSchema>;

export interface BeszelInventory {
  systems: BeszelSystem[];
  containers: BeszelContainer[];
  /** Records that failed validation and were skipped. */
  skipped: number;
}

export interface BeszelClient {
  fetchInventory(): Promise<BeszelInventory>;
}

/** Error whose message is safe to show to API clients and logs. */
export class LiveSourceError extends Error {
  override name = 'LiveSourceError';
}

const authResponseSchema = z.object({ token: z.string().min(1) });
const pageSchema = z.object({ items: z.array(z.unknown()) });

type FetchLike = typeof fetch;

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'request timed out';
    const cause = (error as Error & { cause?: { code?: unknown } }).cause;
    if (cause && typeof cause.code === 'string') return cause.code;
  }
  return 'network error';
}

export function createBeszelClient(
  config: BeszelConfig,
  fetchImpl: FetchLike = fetch
): BeszelClient {
  let token: string | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${config.url}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new LiveSourceError(
        `Beszel is unreachable (${describeNetworkError(error)})`
      );
    }
  }

  async function login(): Promise<string> {
    const response = await request(
      '/api/collections/users/auth-with-password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: config.email,
          password: config.password
        })
      }
    );
    if (!response.ok) {
      throw new LiveSourceError(
        `Beszel login failed (HTTP ${response.status}); check BESZEL_EMAIL and BESZEL_PASSWORD`
      );
    }
    const parsed = authResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LiveSourceError('Beszel login returned an unexpected response');
    }
    return parsed.data.token;
  }

  async function getJson(path: string): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      token ??= await login();
      const response = await request(path, {
        headers: { Authorization: token, Accept: 'application/json' }
      });
      if (response.status === 401 || response.status === 403) {
        token = null; // expired or revoked: log in once more
        continue;
      }
      if (!response.ok) {
        throw new LiveSourceError(
          `Beszel request failed (HTTP ${response.status})`
        );
      }
      return response.json();
    }
    throw new LiveSourceError('Beszel rejected the credentials after re-login');
  }

  async function listAll<T>(
    collection: string,
    fields: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>
  ): Promise<{ records: T[]; skipped: number }> {
    const records: T[] = [];
    let skipped = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        perPage: String(PAGE_SIZE),
        skipTotal: '1',
        fields
      });
      const body = pageSchema.safeParse(
        await getJson(`/api/collections/${collection}/records?${query}`)
      );
      if (!body.success) {
        throw new LiveSourceError(
          `Beszel returned an unexpected ${collection} page`
        );
      }
      for (const item of body.data.items) {
        const parsed = schema.safeParse(item);
        if (parsed.success) records.push(parsed.data);
        else skipped += 1;
      }
      if (body.data.items.length < PAGE_SIZE) break;
    }
    return { records, skipped };
  }

  return {
    async fetchInventory() {
      const systems = await listAll(
        'systems',
        'id,name,status,info',
        beszelSystemSchema
      );
      const containers = await listAll(
        'containers',
        'system,name,image,status,health,cpu,memory,updatable,updated',
        beszelContainerSchema
      );
      return {
        systems: systems.records,
        containers: containers.records,
        skipped: systems.skipped + containers.skipped
      };
    }
  };
}
