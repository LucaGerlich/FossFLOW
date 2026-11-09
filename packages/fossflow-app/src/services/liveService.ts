import { useEffect, useState } from 'react';
import type { LiveSnapshot } from 'fossflow';

/**
 * Live data from the backend's `/api/live` (same-origin: nginx in production,
 * the dev-server proxy in development). Without a backend, or with live data
 * disabled, this stays `off` and the editor works as plain FossFLOW.
 */

const POLL_MS = 15_000;
const MAX_BACKOFF_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type LiveConnection = 'off' | 'ok' | 'error';

export interface LiveData {
  snapshot: LiveSnapshot | undefined;
  connection: LiveConnection;
  /** Technical detail for tooltips; not translated. */
  error: string | null;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function isSnapshot(value: unknown): value is LiveSnapshot {
  const candidate = value as Partial<LiveSnapshot> | null;
  return (
    !!candidate &&
    Array.isArray(candidate.systems) &&
    Array.isArray(candidate.sources)
  );
}

export function useLiveData(): LiveData {
  const [data, setData] = useState<LiveData>({
    snapshot: undefined,
    connection: 'off',
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let delay = POLL_MS;

    const schedule = (ms: number) => {
      timer = window.setTimeout(() => void tick(), ms);
    };

    async function tick(): Promise<void> {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') {
        schedule(POLL_MS);
        return;
      }
      try {
        const body = await getJson('/api/live/snapshot');
        if (!isSnapshot(body)) throw new Error('unexpected response');
        if (cancelled) return;
        const failing = body.sources.find((source) => !source.ok);
        setData({
          snapshot: body,
          connection: failing ? 'error' : 'ok',
          error: failing ? `${failing.name}: ${failing.error ?? 'error'}` : null
        });
        delay = POLL_MS;
      } catch (error) {
        if (cancelled) return;
        setData((previous) => ({
          ...previous,
          connection: 'error',
          error: error instanceof Error ? error.message : 'request failed'
        }));
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      schedule(delay);
    }

    async function start(): Promise<void> {
      try {
        const status = (await getJson('/api/live/status')) as {
          enabled?: unknown;
        };
        if (status?.enabled !== true) return;
      } catch {
        return; // no backend: plain diagramming
      }
      await tick();
    }

    void start();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return data;
}
