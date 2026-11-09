import type { BeszelContainer, BeszelSystem } from './beszel.ts';
import type {
  LiveContainer,
  LiveContainerKind,
  LiveHealth,
  LiveHistory,
  LiveStatus,
  LiveSystem,
  LiveVitals
} from './types.ts';

// ponytail: fixed thresholds; per-item baselines ("6x its normal") come later.
export const VITALS_WARNING_PERCENT = 80;
export const VITALS_CRITICAL_PERCENT = 90;

/** Container records not refreshed for this long are treated as gone. */
export const STALE_CONTAINER_MS = 10 * 60_000;

/**
 * Agents report every running container with each system report, so a
 * container whose last report is older than its system's latest one (plus
 * some slack) has stopped. Detects stops in ~1-2 min instead of 10.
 */
export const CONTAINER_REPORT_LAG_MS = 90_000;

function isCurrent(
  container: BeszelContainer,
  systemUpdated: number | undefined,
  nowMs: number
): boolean {
  if (container.updated === undefined) return true;
  if (systemUpdated !== undefined) {
    return systemUpdated - container.updated <= CONTAINER_REPORT_LAG_MS;
  }
  return nowMs - container.updated <= STALE_CONTAINER_MS;
}

const HEALTH_BY_CODE: Record<number, LiveHealth> = {
  0: 'none',
  1: 'starting',
  2: 'healthy',
  3: 'unhealthy'
};

const KIND_PATTERNS: Array<[LiveContainerKind, RegExp]> = [
  [
    'database',
    /(^|[/_-])(postgres|postgis|timescale|mysql|mariadb|mongo|cockroach|clickhouse|couchdb)/
  ],
  ['cache', /(^|[/_-])(redis|valkey|keydb|dragonfly|memcached)/],
  ['queue', /(^|[/_-])(rabbitmq|nats|kafka|redpanda|activemq|mosquitto)/],
  ['gateway', /(^|[/_-])(traefik|nginx|caddy|haproxy|envoy|kong)/]
];

/** Guesses what a container is from its image reference. */
export function detectKind(image: string): LiveContainerKind {
  const repository = image.toLowerCase().split('@')[0]?.split(':')[0] ?? '';
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(repository)) return kind;
  }
  return 'container';
}

function containerStatus(health: LiveHealth): LiveStatus {
  if (health === 'unhealthy') return 'critical';
  if (health === 'starting') return 'warning';
  return 'ok';
}

export function systemStatus(state: string, vitals: LiveVitals): LiveStatus {
  if (state === 'down') return 'critical';
  if (state !== 'up') return 'unknown';
  const peak = Math.max(vitals.cpu, vitals.memory, vitals.disk);
  if (peak >= VITALS_CRITICAL_PERCENT) return 'critical';
  if (peak >= VITALS_WARNING_PERCENT) return 'warning';
  return 'ok';
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function toVitals(info: BeszelSystem['info']): LiveVitals {
  const bandwidth = info?.bb ?? (info?.b ?? 0) * 1024 * 1024;
  const load = info?.la;
  return {
    cpu: round1(info?.cpu ?? 0),
    memory: round1(info?.mp ?? 0),
    disk: round1(info?.dp ?? 0),
    networkBytesPerSec: Math.max(0, Math.round(bandwidth)),
    load: load ? [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0] : null,
    uptimeSec: Math.max(0, Math.round(info?.u ?? 0)),
    temperatureC: info?.dt ? round1(info.dt) : null
  };
}

export function toContainer(
  sourceId: string,
  record: BeszelContainer
): LiveContainer {
  const health = HEALTH_BY_CODE[record.health] ?? 'none';
  return {
    key: `${sourceId}:${record.system}/${record.name}`,
    name: record.name,
    image: record.image,
    kind: detectKind(record.image),
    status: containerStatus(health),
    health,
    state: record.status,
    cpu: round1(record.cpu),
    memoryMb: round1(record.memory),
    updateAvailable: record.updatable === true
  };
}

export interface NormalizeInput {
  sourceId: string;
  systems: BeszelSystem[];
  containers: BeszelContainer[];
  historyFor: (systemKey: string, vitals: LiveVitals) => LiveHistory;
  nowMs: number;
}

/** Maps Beszel records to live systems, sorted by name for a stable layout. */
export function normalizeInventory(input: NormalizeInput): LiveSystem[] {
  return input.systems
    .map((record): LiveSystem => {
      const key = `${input.sourceId}:${record.id}`;
      const vitals = toVitals(record.info);
      return {
        key,
        name: record.name,
        status: systemStatus(record.status, vitals),
        state: record.status,
        vitals,
        history: input.historyFor(key, vitals),
        containers: input.containers
          .filter(
            (container) =>
              container.system === record.id &&
              isCurrent(container, record.updated, input.nowMs)
          )
          .map((container) => toContainer(input.sourceId, container))
          .sort((a, b) => a.name.localeCompare(b.name))
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
