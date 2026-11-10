import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { DecryptionError } from '../crypto/cipher.js';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscapeSource } from '../database/schema.js';
import { createLiveHub, type LiveHub } from './hub.js';
import type { LiveSnapshot, LiveSourceHealth } from './types.js';

const logger = new Logger('Live');
const liveLogger = {
  info: (message: string) => logger.log(message),
  warn: (message: string) => logger.warn(message)
};

interface RunningSource {
  hub: LiveHub;
  /** The credential's updatedAt when the poller started; a change restarts it. */
  version: string;
}

/**
 * Runs one poller per credential that at least one landscape shows, and
 * stops pollers nobody needs. Call `refresh()` after anything changes which
 * credentials are in use (it is serialised, so calls never overlap).
 */
@Injectable()
export class LiveSourcesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly running = new Map<string, RunningSource>();
  /** Sources that couldn't start, with a message safe to show. */
  private readonly failed = new Map<string, LiveSourceHealth>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly credentials: CredentialsService
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.refresh();
  }

  onApplicationShutdown(): void {
    for (const source of this.running.values()) source.hub.stop();
    this.running.clear();
  }

  refresh(): Promise<void> {
    this.queue = this.queue
      .then(() => this.reconcile())
      .catch((error: unknown) => {
        logger.warn(`Could not update live sources: ${error instanceof Error ? error.message : String(error)}`);
      });
    return this.queue;
  }

  /** The combined live data of a landscape's sources. */
  async snapshotFor(landscapeId: string): Promise<LiveSnapshot> {
    const sources = await this.db
      .select({ id: credential.id, name: credential.name, type: credential.type })
      .from(landscapeSource)
      .innerJoin(credential, eq(credential.id, landscapeSource.credentialId))
      .where(eq(landscapeSource.landscapeId, landscapeId));

    const parts = sources.map((source): LiveSnapshot => {
      const running = this.running.get(source.id);
      if (running) return running.hub.getSnapshot();
      const health = this.failed.get(source.id) ?? {
        ...source,
        ok: false,
        lastSync: null,
        error: null
      };
      return { updatedAt: null, systems: [], sources: [health] };
    });

    const times = parts.map((part) => part.updatedAt).filter((at): at is string => at !== null);
    return {
      updatedAt: times.length ? times.sort().at(-1) ?? null : null,
      systems: parts.flatMap((part) => part.systems),
      sources: parts.flatMap((part) => part.sources)
    };
  }

  private async reconcile(): Promise<void> {
    const wanted = await this.db
      .selectDistinct({
        id: credential.id,
        name: credential.name,
        type: credential.type,
        updatedAt: credential.updatedAt
      })
      .from(credential)
      .innerJoin(landscapeSource, eq(landscapeSource.credentialId, credential.id));
    const wantedIds = new Set(wanted.map((row) => row.id));

    for (const [id, source] of this.running) {
      if (!wantedIds.has(id)) {
        source.hub.stop();
        this.running.delete(id);
      }
    }
    for (const id of this.failed.keys()) if (!wantedIds.has(id)) this.failed.delete(id);

    for (const row of wanted) {
      const version = row.updatedAt.toISOString();
      const current = this.running.get(row.id);
      if (current?.version === version) continue;
      current?.hub.stop();
      this.running.delete(row.id);

      try {
        const { connector, settings, name } = await this.credentials.settingsFor(row.id);
        const hub = createLiveHub({
          source: { id: row.id, type: connector.id, name },
          client: connector.open(settings),
          pollSeconds: this.config.livePollSeconds,
          logger: liveLogger
        });
        hub.start();
        this.running.set(row.id, { hub, version });
        this.failed.delete(row.id);
      } catch (error) {
        if (error instanceof NotFoundException) continue; // Deleted meanwhile.
        const message =
          error instanceof DecryptionError
            ? 'Stored settings can’t be decrypted. Was the encryption key changed?'
            : 'Stored settings are invalid. Edit the credential to fix them.';
        logger.warn(`${row.name}: ${message}`);
        this.failed.set(row.id, { id: row.id, name: row.name, type: row.type, ok: false, lastSync: null, error: message });
      }
    }
  }
}
