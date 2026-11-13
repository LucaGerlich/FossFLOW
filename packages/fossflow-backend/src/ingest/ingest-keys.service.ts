import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  type BeforeApplicationShutdown,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { count, desc, eq, inArray } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { ingestKey, ingestService } from '../database/schema.js';
import { user } from '../database/auth-schema.js';
import { type SetupBlock, setupBlocks } from './setup-blocks.js';

export interface IngestKeySummary {
  id: string;
  name: string;
  prefix: string;
  /** The creator's name; null once that account is gone. */
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  services: { name: string; lastSeenAt: Date }[];
}

export type CreatedIngestKey = IngestKeySummary & {
  /** The full key; this response is the only time it is shown. */
  key: string;
  endpoint: string;
  setup: SetupBlock[];
};

export interface IngestKeyRef {
  id: string;
  projectId: string;
}

const KEY_PATTERN = /^ffi_[A-Za-z0-9_-]{43}$/;
const PREFIX_LENGTH = 12;
const MAX_KEYS_PER_PROJECT = 50;

const RELOAD_MS = 30_000;
const logger = new Logger('IngestKeys');

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Keys are authenticated from an in-memory index of every key hash, so a flood of
 * invalid keys never reaches the database. The index is updated on create and remove,
 * and rebuilt every 30 s to pick up cascades (a deleted project or user).
 */
@Injectable()
export class IngestKeysService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private index = new Map<string, IngestKeyRef>();
  private timer: NodeJS.Timeout | undefined;
  /** reload, create and remove run one after another, so a stale snapshot can't drop a new key. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      logger.warn(`Could not load ingest keys (${error instanceof Error ? error.name : 'unknown error'}); retrying`);
    }
    this.timer = setInterval(() => {
      this.reload().catch((error: unknown) => {
        logger.warn(`Could not reload ingest keys (${error instanceof Error ? error.name : 'unknown error'})`);
      });
    }, RELOAD_MS);
    this.timer.unref();
  }

  beforeApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Rebuilds the index from the database and swaps it in. */
  reload(): Promise<void> {
    return this.serialise(async () => {
      const rows = await this.db
        .select({ id: ingestKey.id, projectId: ingestKey.projectId, keyHash: ingestKey.keyHash })
        .from(ingestKey);
      this.index = new Map(rows.map((row) => [row.keyHash, { id: row.id, projectId: row.projectId }]));
    });
  }

  async list(projectId: string): Promise<IngestKeySummary[]> {
    const rows = await this.db
      .select({
        id: ingestKey.id,
        name: ingestKey.name,
        prefix: ingestKey.prefix,
        createdBy: user.name,
        createdAt: ingestKey.createdAt,
        lastUsedAt: ingestKey.lastUsedAt
      })
      .from(ingestKey)
      .leftJoin(user, eq(user.id, ingestKey.createdBy))
      .where(eq(ingestKey.projectId, projectId))
      .orderBy(desc(ingestKey.createdAt));
    if (rows.length === 0) return [];
    const seen = await this.db
      .select()
      .from(ingestService)
      .where(
        inArray(
          ingestService.keyId,
          rows.map((row) => row.id)
        )
      )
      .orderBy(ingestService.serviceName);
    return rows.map((row) => ({
      ...row,
      services: seen
        .filter((service) => service.keyId === row.id)
        .map((service) => ({ name: service.serviceName, lastSeenAt: service.lastSeenAt }))
    }));
  }

  create(projectId: string, userId: string, name: string): Promise<CreatedIngestKey> {
    return this.serialise(() => this.insertKey(projectId, userId, name));
  }

  private async insertKey(projectId: string, userId: string, name: string): Promise<CreatedIngestKey> {
    const [existing] = await this.db
      .select({ total: count() })
      .from(ingestKey)
      .where(eq(ingestKey.projectId, projectId));
    if ((existing?.total ?? 0) >= MAX_KEYS_PER_PROJECT) {
      throw new ConflictException({ error: `This project already has ${MAX_KEYS_PER_PROJECT} ingest keys` });
    }
    const key = `ffi_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    const [row] = await this.db
      .insert(ingestKey)
      .values({ id, projectId, name, keyHash: hashKey(key), prefix: key.slice(0, PREFIX_LENGTH), createdBy: userId })
      .returning();
    if (!row) throw new Error('ingest key was not saved');
    this.index.set(row.keyHash, { id: row.id, projectId: row.projectId });
    const [creator] = await this.db.select({ name: user.name }).from(user).where(eq(user.id, userId));
    const endpoint = `${this.config.publicUrl}/api/otlp`;
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdBy: creator?.name ?? null,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      services: [],
      key,
      endpoint,
      setup: setupBlocks({ endpoint, key, serviceName: name })
    };
  }

  remove(id: string): Promise<void> {
    return this.serialise(async () => {
      const removed = await this.db
        .delete(ingestKey)
        .where(eq(ingestKey.id, id))
        .returning({ keyHash: ingestKey.keyHash });
      const [row] = removed;
      if (!row) throw new NotFoundException('Ingest key not found');
      this.index.delete(row.keyHash);
    });
  }

  /**
   * Finds the key a request presented, from the in-memory index: the format check, the SHA-256 hash
   * and a map lookup, with no database query. A caller cannot steer the hash, so lookup timing
   * reveals nothing about stored keys.
   */
  async authenticate(presented: string | undefined): Promise<IngestKeyRef | null> {
    if (presented === undefined || !KEY_PATTERN.test(presented)) return null;
    return this.index.get(hashKey(presented)) ?? null;
  }
}
