import { useQuery } from '@tanstack/react-query';
import type {
  TrafficEdgeDetail,
  TrafficFeed,
  TrafficPair,
  TrafficRange,
  TrafficStreamMessage,
  TrafficSummary
} from 'fossflow';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const SUMMARY_REFETCH_MS = 15_000;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 120_000;

export type TrafficStatus = 'off' | 'connecting' | 'live';

type TrafficListener = (message: TrafficStreamMessage) => void;

const trafficPath = (landscapeId: string) =>
  `/api/landscapes/${encodeURIComponent(landscapeId)}/traffic`;

export const trafficSummaryKey = (landscapeId: string) =>
  ['traffic-summary', landscapeId] as const;

/** Refetches every 15 s: the summary drives arrow state, the stream only the dots. */
export function useTrafficSummary(landscapeId: string) {
  return useQuery({
    queryKey: trafficSummaryKey(landscapeId),
    queryFn: () => api<TrafficSummary>(`${trafficPath(landscapeId)}/summary`),
    refetchInterval: SUMMARY_REFETCH_MS
  });
}

/** Detail of one arrow: `pairs` are every caller → callee pair the arrow stands for. */
export function loadTrafficEdge(
  landscapeId: string,
  pairs: TrafficPair[],
  range: TrafficRange
): Promise<TrafficEdgeDetail> {
  const query = new URLSearchParams();
  for (const pair of pairs) {
    query.append('caller', pair.caller);
    query.append('callee', pair.callee);
  }
  query.set('range', range);
  return api<TrafficEdgeDetail>(`${trafficPath(landscapeId)}/edge?${query.toString()}`);
}

function isStreamMessage(value: unknown): value is TrafficStreamMessage {
  const candidate = value as Partial<TrafficStreamMessage> | null;
  return (
    !!candidate &&
    typeof candidate.sentAt === 'number' &&
    Array.isArray(candidate.dots)
  );
}

/**
 * One server-sent-events connection per landscape while `enabled` and the tab is
 * visible, fanned out to subscribers. `subscribe` keeps its identity for the
 * landscape's lifetime, so the map's subscription is never torn down by a rerender.
 */
export function useTrafficStream(
  landscapeId: string,
  enabled: boolean
): { subscribe: TrafficFeed['subscribe']; status: TrafficStatus } {
  const listeners = useRef(new Set<TrafficListener>());
  const [status, setStatus] = useState<TrafficStatus>('off');

  const subscribe = useCallback<TrafficFeed['subscribe']>((listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    const url = `${trafficPath(landscapeId)}/stream`;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let backoff = BASE_BACKOFF_MS;

    const close = () => {
      window.clearTimeout(retryTimer);
      retryTimer = undefined;
      source?.close();
      source = null;
    };

    const open = () => {
      close();
      setStatus('connecting');
      const stream = new EventSource(url);
      source = stream;
      stream.onopen = () => {
        backoff = BASE_BACKOFF_MS;
        setStatus('live');
      };
      stream.onmessage = (event: MessageEvent<string>) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!isStreamMessage(parsed)) return;
        listeners.current.forEach((listener) => listener(parsed));
      };
      stream.onerror = () => {
        setStatus('connecting');
        // CONNECTING: the browser retries on its own (server `retry: 2000`).
        // CLOSED: the server refused (401, 404, 429), so back off ourselves.
        if (stream.readyState !== EventSource.CLOSED) return;
        stream.close();
        source = null;
        retryTimer = window.setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        backoff = BASE_BACKOFF_MS;
        open();
      } else {
        close();
        setStatus('connecting');
      }
    };

    if (document.visibilityState === 'visible') open();
    else setStatus('connecting');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      close();
      setStatus('off');
    };
  }, [landscapeId, enabled]);

  return { subscribe, status };
}

/**
 * The map's traffic feed, or `undefined` until the first summary arrives.
 * The stream only opens once the summary shows any traffic. `subscribe` and
 * `loadEdge` keep their identity per landscape; only `feed` changes with the summary.
 */
export function useTrafficFeed(landscapeId: string): {
  feed: TrafficFeed | undefined;
  status: TrafficStatus;
} {
  const summary = useTrafficSummary(landscapeId).data;
  const hasTraffic = !!summary && (summary.edges.length > 0 || summary.services.length > 0);
  const { subscribe, status } = useTrafficStream(landscapeId, hasTraffic);

  const loadEdge = useCallback<TrafficFeed['loadEdge']>(
    (pairs, range) => loadTrafficEdge(landscapeId, pairs, range),
    [landscapeId]
  );

  const feed = useMemo<TrafficFeed | undefined>(
    () => (summary ? { summary, subscribe, loadEdge } : undefined),
    [summary, subscribe, loadEdge]
  );

  return { feed, status };
}
