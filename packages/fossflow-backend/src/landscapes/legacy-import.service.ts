import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { landscape, meta, projectRelation, user } from '../database/schema.js';
import { landscapeModelSchema, withoutBuiltInIcons } from './model.js';

const FLAG = 'migration.legacyDiagrams';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * One-time import of diagrams saved by the old file-based "server storage"
 * (`<data dir>/diagrams/*.json`) into the owner's personal project. Runs once
 * an owner exists; the files are only read, never changed or deleted.
 */
@Injectable()
export class LegacyImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger('LegacyImport');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.importIfPending();
  }

  async importIfPending(): Promise<void> {
    const [owner] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.instanceRole, 'global:owner'))
      .orderBy(asc(user.createdAt))
      .limit(1);
    if (!owner) return; // Waits for the first-run setup.

    const [personal] = await this.db
      .select({ projectId: projectRelation.projectId })
      .from(projectRelation)
      .where(
        and(eq(projectRelation.userId, owner.id), eq(projectRelation.role, 'project:personalOwner'))
      );
    if (!personal) return;

    // Claim the run first, so two starts can't import twice.
    const claimed = await this.db
      .insert(meta)
      .values({ key: FLAG, value: { status: 'running' } })
      .onConflictDoNothing()
      .returning({ key: meta.key });
    if (claimed.length === 0) return;

    const result = await this.importFrom(join(this.config.dataDir, 'diagrams'), personal.projectId, owner.id);
    await this.db
      .update(meta)
      .set({ value: { status: 'done', ...result }, updatedAt: new Date() })
      .where(eq(meta.key, FLAG));
    if (result.imported > 0 || result.skipped > 0) {
      this.logger.log(
        `Imported ${result.imported} diagram(s) from the old file storage into the owner's personal project` +
          (result.skipped ? `; skipped ${result.skipped} unreadable file(s)` : '')
      );
    }
  }

  private async importFrom(
    dir: string,
    projectId: string,
    ownerId: string
  ): Promise<{ imported: number; skipped: number }> {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
    } catch {
      return { imported: 0, skipped: 0 }; // No old storage on this instance.
    }

    let imported = 0;
    let skipped = 0;
    for (const file of files) {
      try {
        const text = await readFile(join(dir, file), 'utf8');
        if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('too large');
        const raw = JSON.parse(text) as { name?: unknown; title?: unknown };
        const model = withoutBuiltInIcons(landscapeModelSchema.parse(raw));
        const name =
          [raw.name, raw.title].find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim().slice(0, 200) ??
          basename(file, '.json');
        await this.db.insert(landscape).values({
          id: randomUUID(),
          projectId,
          name,
          model: { ...model, title: name },
          createdBy: ownerId,
          updatedBy: ownerId
        });
        imported += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `Skipped ${file}: ${error instanceof Error ? error.message.slice(0, 120) : 'unreadable'}`
        );
      }
    }
    return { imported, skipped };
  }
}
