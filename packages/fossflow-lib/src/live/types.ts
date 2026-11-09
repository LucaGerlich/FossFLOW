/**
 * Live data passed to `<Isoflow live={...} />`.
 *
 * Mirrors the backend wire contract in
 * `packages/fossflow-backend/live/types.ts`; keep both in sync. The lib is
 * source-agnostic: it only knows keys, statuses and numbers.
 */

export type LiveSourceStatus = 'ok' | 'warning' | 'critical' | 'unknown';

/**
 * Status as displayed on the map. `stopped` is derived here: a bound
 * container that is missing from the snapshot (sources only list running ones).
 */
export type LiveDisplayStatus = LiveSourceStatus | 'stopped';

export type LiveContainerKind =
  | 'container'
  | 'database'
  | 'cache'
  | 'queue'
  | 'gateway';

export type LiveHealth = 'none' | 'starting' | 'healthy' | 'unhealthy';

export interface LiveContainer {
  key: string;
  name: string;
  image: string;
  kind: LiveContainerKind;
  status: LiveSourceStatus;
  health: LiveHealth;
  state: string;
  cpu: number;
  memoryMb: number;
  updateAvailable: boolean;
}

export interface LiveVitals {
  cpu: number;
  memory: number;
  disk: number;
  networkBytesPerSec: number;
  load: [number, number, number] | null;
  uptimeSec: number;
  temperatureC: number | null;
}

export interface LiveHistory {
  cpu: number[];
  memory: number[];
  disk: number[];
}

export interface LiveSystem {
  key: string;
  name: string;
  status: LiveSourceStatus;
  state: string;
  vitals: LiveVitals;
  history: LiveHistory;
  containers: LiveContainer[];
}

export interface LiveSourceHealth {
  id: string;
  type: string;
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
