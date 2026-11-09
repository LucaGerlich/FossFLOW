/**
 * Wire contract for `/api/live/*`.
 *
 * Mirrored by `packages/fossflow-lib/src/live/types.ts`; keep both in sync.
 * Everything here is source-agnostic: adapters (Beszel today) map their own
 * records into these shapes so the map never needs to know where data came from.
 */

export type LiveStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type LiveContainerKind =
  | 'container'
  | 'database'
  | 'cache'
  | 'queue'
  | 'gateway';

export type LiveHealth = 'none' | 'starting' | 'healthy' | 'unhealthy';

export interface LiveContainer {
  /** Stable binding key: `<sourceId>:<systemId>/<containerName>`. */
  key: string;
  name: string;
  image: string;
  kind: LiveContainerKind;
  status: LiveStatus;
  health: LiveHealth;
  /** Human-readable runtime state from the source, e.g. "Up 3 hours". */
  state: string;
  /** CPU usage in percent. */
  cpu: number;
  memoryMb: number;
  updateAvailable: boolean;
}

export interface LiveVitals {
  /** Percentages, 0-100. */
  cpu: number;
  memory: number;
  disk: number;
  networkBytesPerSec: number;
  load: [number, number, number] | null;
  uptimeSec: number;
  temperatureC: number | null;
}

/** Recent samples, oldest first, one per poll. */
export interface LiveHistory {
  cpu: number[];
  memory: number[];
  disk: number[];
}

export interface LiveSystem {
  /** Stable binding key: `<sourceId>:<systemId>`. */
  key: string;
  name: string;
  status: LiveStatus;
  /** Source-specific state, e.g. Beszel's `up` / `down` / `paused` / `pending`. */
  state: string;
  vitals: LiveVitals;
  history: LiveHistory;
  containers: LiveContainer[];
}

export interface LiveSourceHealth {
  id: string;
  type: 'beszel';
  name: string;
  ok: boolean;
  lastSync: string | null;
  error: string | null;
}

export interface LiveSnapshot {
  updatedAt: string | null;
  systems: LiveSystem[];
  sources: LiveSourceHealth[];
}

export interface LiveStatusResponse {
  enabled: boolean;
  sources: LiveSourceHealth[];
}
