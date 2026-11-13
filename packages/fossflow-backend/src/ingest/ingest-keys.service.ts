import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
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

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

@Injectable()
export class IngestKeysService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

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

  async create(projectId: string, userId: string, name: string): Promise<CreatedIngestKey> {
    const key = `ffi_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    const [row] = await this.db
      .insert(ingestKey)
      .values({ id, projectId, name, keyHash: hashKey(key), prefix: key.slice(0, PREFIX_LENGTH), createdBy: userId })
      .returning();
    if (!row) throw new Error('ingest key was not saved');
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

  async remove(id: string): Promise<void> {
    const removed = await this.db.delete(ingestKey).where(eq(ingestKey.id, id)).returning({ id: ingestKey.id });
    if (removed.length === 0) throw new NotFoundException('Ingest key not found');
  }

  /**
   * Finds the key a request presented. Malformed input never reaches the database. The lookup is by
   * SHA-256 hash, which a caller cannot steer, so its timing reveals nothing about stored keys.
   */
  async authenticate(presented: string | undefined): Promise<IngestKeyRef | null> {
    if (presented === undefined || !KEY_PATTERN.test(presented)) return null;
    const [row] = await this.db
      .select({ id: ingestKey.id, projectId: ingestKey.projectId })
      .from(ingestKey)
      .where(eq(ingestKey.keyHash, hashKey(presented)));
    return row ?? null;
  }
}
