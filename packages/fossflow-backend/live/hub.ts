import { LiveSourceError, type BeszelClient } from './beszel.ts';
import type { LiveConfig } from './config.ts';
import { normalizeInventory } from './normalize.ts';
import type {
  LiveHistory,
  LiveSnapshot,
  LiveSourceHealth,
  LiveStatusResponse,
  LiveVitals
} from './types.ts';

export const HISTORY_SAMPLES = 60;
const SOURCE_ID = 'beszel';

export interface LiveLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface LiveHub {
  getSnapshot: () => LiveSnapshot;
  getStatus: () => LiveStatusResponse;
  /** Runs one sync; never throws (failures are recorded on the source). */
  syncNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export interface LiveHubOptions {
  config: LiveConfig;
  client: BeszelClient;
  logger: LiveLogger;
  now?: () => Date;
}

function safeMessage(error: unknown): string {
  return error instanceof LiveSourceError
    ? error.message
    : 'unexpected error while syncing';
}

/**
 * Polls the configured source, keeps the last good snapshot in memory and a
 * short per-system history for sparklines.
 * ponytail: in-memory history resets on restart; read Beszel's system_stats
 * if longer or persistent history is needed.
 */
export function createLiveHub(options: LiveHubOptions): LiveHub {
  const now = options.now ?? (() => new Date());
  const history = new Map<string, LiveHistory>();
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let snapshot: LiveSnapshot = { updatedAt: null, systems: [], sources: [] };
  let source: LiveSourceHealth = {
    id: SOURCE_ID,
    type: 'beszel',
    name: 'Beszel',
    ok: false,
    lastSync: null,
    error: 'not synced yet'
  };

  function pushHistory(systemKey: string, vitals: LiveVitals): LiveHistory {
    const previous = history.get(systemKey) ?? {
      cpu: [],
      memory: [],
      disk: []
    };
    const keep = (series: number[], value: number): number[] =>
      [...series, value].slice(-HISTORY_SAMPLES);
    const next = {
      cpu: keep(previous.cpu, vitals.cpu),
      memory: keep(previous.memory, vitals.memory),
      disk: keep(previous.disk, vitals.disk)
    };
    history.set(systemKey, next);
    return next;
  }

  async function runSync(): Promise<void> {
    try {
      const inventory = await options.client.fetchInventory();
      const at = now();
      const systems = normalizeInventory({
        sourceId: SOURCE_ID,
        systems: inventory.systems,
        containers: inventory.containers,
        historyFor: pushHistory,
        nowMs: at.getTime()
      });
      for (const key of history.keys()) {
        if (!systems.some((system) => system.key === key)) history.delete(key);
      }
      if (!source.ok) options.logger.info('[live] Beszel sync OK');
      if (inventory.skipped > 0) {
        options.logger.warn(
          `[live] skipped ${inventory.skipped} malformed Beszel record(s)`
        );
      }
      source = { ...source, ok: true, lastSync: at.toISOString(), error: null };
      snapshot = { updatedAt: at.toISOString(), systems, sources: [source] };
    } catch (error) {
      const message = safeMessage(error);
      if (source.error !== message) options.logger.warn(`[live] ${message}`);
      source = { ...source, ok: false, error: message };
      // Keep the last good systems so the map does not blank out on a blip.
      snapshot = { ...snapshot, sources: [source] };
    }
  }

  function syncNow(): Promise<void> {
    inFlight ??= runSync().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    getSnapshot: () => snapshot,
    getStatus: () => ({ enabled: true, sources: [source] }),
    syncNow,
    start() {
      if (timer) return;
      void syncNow();
      timer = setInterval(
        () => void syncNow(),
        options.config.pollSeconds * 1000
      );
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
