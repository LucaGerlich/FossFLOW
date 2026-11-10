import { useEffect, useState } from 'react';
import type { LiveSnapshot } from 'fossflow';

/**
 * Live data of one platform landscape, from `/api/landscapes/:id/live`
 * (same-origin: nginx in production, the dev-server proxy in development).
 * Without a landscape id (no sources attached) this stays `off`. A new
 * `revision` (e.g. the attached source ids) polls again right away.
 */

const POLL_MS = 15_000;
/** While a source's first sync runs, ask again soon. */
const CONNECTING_POLL_MS = 2_000;
const MAX_BACKOFF_MS = 120_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type LiveConnection = 'off' | 'connecting' | 'ok' | 'error';

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

export function useLiveData(landscapeId: string | null, revision = ''): LiveData {
  const [data, setData] = useState<LiveData>({
    snapshot: undefined,
    connection: 'off',
    error: null
  });

  useEffect(() => {
    if (landscapeId === null) {
      setData({ snapshot: undefined, connection: 'off', error: null });
      return;
    }
    const path = `/api/landscapes/${encodeURIComponent(landscapeId)}/live`;
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
        const body = await getJson(path);
        if (!isSnapshot(body)) throw new Error('unexpected response');
        if (cancelled) return;
        const failing = body.sources.find((source) => !source.ok && source.error !== null);
        const connecting = body.sources.some((source) => !source.ok && source.error === null);
        setData({
          snapshot: body,
          connection: failing ? 'error' : connecting ? 'connecting' : 'ok',
          error: failing ? `${failing.name}: ${failing.error}` : null
        });
        delay = connecting ? CONNECTING_POLL_MS : POLL_MS;
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

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [landscapeId, revision]);

  return data;
}
