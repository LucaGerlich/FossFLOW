import type {
  LiveContainer,
  LiveDisplayStatus,
  LiveSnapshot,
  LiveSystem
} from './types';

export interface LiveIndex {
  systems: Map<string, LiveSystem>;
  containers: Map<string, { container: LiveContainer; system: LiveSystem }>;
}

export type LiveEntity =
  | { type: 'system'; status: LiveDisplayStatus; system: LiveSystem | null }
  | {
      type: 'container';
      status: LiveDisplayStatus;
      container: LiveContainer | null;
      system: LiveSystem | null;
    };

export function buildLiveIndex(snapshot: LiveSnapshot): LiveIndex {
  const systems = new Map<string, LiveSystem>();
  const containers = new Map<
    string,
    { container: LiveContainer; system: LiveSystem }
  >();
  for (const system of snapshot.systems) {
    systems.set(system.key, system);
    for (const container of system.containers) {
      containers.set(container.key, { container, system });
    }
  }
  return { systems, containers };
}

/**
 * What a bound key looks like right now.
 * Container keys are `<systemKey>/<containerName>`. A container missing from
 * a present system is `stopped` (sources only list running containers); one
 * whose system is missing too, or a missing server, is `unknown`.
 */
export function resolveLive(index: LiveIndex, key: string): LiveEntity {
  const system = index.systems.get(key);
  if (system) return { type: 'system', status: system.status, system };

  const found = index.containers.get(key);
  if (found) {
    return {
      type: 'container',
      status: found.container.status,
      container: found.container,
      system: found.system
    };
  }

  const slash = key.indexOf('/');
  if (slash === -1) return { type: 'system', status: 'unknown', system: null };
  const parent = index.systems.get(key.slice(0, slash)) ?? null;
  return {
    type: 'container',
    status: parent ? 'stopped' : 'unknown',
    container: null,
    system: parent
  };
}
