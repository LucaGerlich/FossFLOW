import { LiveSourceError } from './source-error.js';
import type {
  LiveHistory,
  LiveSnapshot,
  LiveSourceHealth,
  LiveSystem,
  LiveVitals
} from './types.js';

export const HISTORY_SAMPLES = 60;
/** After this many poll intervals without a good sync, data is shown as unknown. */
export const STALE_AFTER_POLLS = 3;

export interface LiveLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/** What a connector's client gets for one poll. */
export interface FetchContext {
  /** Prefix for every binding key, so two sources never collide. */
  sourceId: string;
  historyFor: (systemKey: string, vitals: LiveVitals) => LiveHistory;
  nowMs: number;
}

export interface FetchResult {
  systems: LiveSystem[];
  /** Records the source sent that couldn't be read. */
  skipped: number;
  /** The source had more records than one poll reads. */
  truncated: boolean;
}

/** A connected source, e.g. one Beszel hub with its login. */
export interface SourceClient {
  fetch: (context: FetchContext) => Promise<FetchResult>;
}

export interface LiveHub {
  getSnapshot: () => LiveSnapshot;
  getHealth: () => LiveSourceHealth;
  /** Runs one sync; never throws (failures are recorded on the source). */
  syncNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export interface LiveHubOptions {
  /** `id` is the credential id; `type` the connector; `name` what people see. */
  source: { id: string; type: string; name: string };
  client: SourceClient;
  pollSeconds: number;
  logger: LiveLogger;
  now?: () => Date;
}

/** Last-known data, re-labelled `unknown`: numbers stay readable, colours don't lie. */
function markUnknown(snapshot: LiveSnapshot): LiveSnapshot {
  return {
    ...snapshot,
    systems: snapshot.systems.map((system) => ({
      ...system,
      status: 'unknown',
      containers: system.containers.map((container) => ({
        ...container,
        status: 'unknown'
      }))
    }))
  };
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
    ...options.source,
    ok: false,
    lastSync: null,
    error: null
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
      const at = now();
      const inventory = await options.client.fetch({
        sourceId: options.source.id,
        historyFor: pushHistory,
        nowMs: at.getTime()
      });
      const { systems } = inventory;
      for (const key of history.keys()) {
        if (!systems.some((system) => system.key === key)) history.delete(key);
      }
      if (!source.ok) options.logger.info(`${source.name}: sync OK`);
      if (inventory.truncated) {
        options.logger.warn(
          `${source.name}: more records than one poll reads; some are not shown`
        );
      }
      if (inventory.skipped > 0) {
        options.logger.warn(
          `${source.name}: skipped ${inventory.skipped} unreadable record(s)`
        );
      }
      source = { ...source, ok: true, lastSync: at.toISOString(), error: null };
      snapshot = { updatedAt: at.toISOString(), systems, sources: [source] };
    } catch (error) {
      const message = safeMessage(error);
      if (source.error !== message) options.logger.warn(`${source.name}: ${message}`);
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
    getSnapshot: () => {
      const staleAfterMs = options.pollSeconds * 1000 * STALE_AFTER_POLLS;
      const lastSync = source.lastSync ? Date.parse(source.lastSync) : null;
      const stale =
        lastSync !== null && now().getTime() - lastSync > staleAfterMs;
      return stale ? markUnknown(snapshot) : snapshot;
    },
    getHealth: () => source,
    syncNow,
    start() {
      if (timer) return;
      void syncNow();
      timer = setInterval(() => void syncNow(), options.pollSeconds * 1000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
