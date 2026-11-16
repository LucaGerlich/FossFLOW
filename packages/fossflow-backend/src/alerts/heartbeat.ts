import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { ingestGap, meta } from '../database/schema.js';

export const ALIVE_KEY = 'ingest.alive';
/** A silence longer than this between two heartbeats counts as a gap. */
export const GAP_MS = 5 * 60_000;

const isAlive = (value: unknown): value is { at: string } =>
  typeof value === 'object' && value !== null && typeof (value as { at?: unknown }).at === 'string';

/**
 * Remembers when this server was last running, so silence while it was down
 * (a restart, an outage) is not blamed on the services that report to it.
 */
@Injectable()
export class IngestHeartbeat {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** On start: when the last heartbeat is over 5 minutes old, the time since then is a gap. */
  async recordStart(now: Date): Promise<void> {
    const [row] = await this.db.select().from(meta).where(eq(meta.key, ALIVE_KEY));
    if (!row || !isAlive(row.value)) return;
    const last = new Date(row.value.at);
    if (Number.isNaN(last.getTime()) || now.getTime() - last.getTime() <= GAP_MS) return;
    await this.db.insert(ingestGap).values({ from: last, to: now });
  }

  async beat(now: Date): Promise<void> {
    const value = { at: now.toISOString() };
    await this.db
      .insert(meta)
      .values({ key: ALIVE_KEY, value })
      .onConflictDoUpdate({ target: meta.key, set: { value, updatedAt: now } });
  }
}
