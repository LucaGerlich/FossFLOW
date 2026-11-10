import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { beszelConnector } from '../connectors/beszel.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscape, landscapeSource, meta } from '../database/schema.js';
import { landscapeModelSchema } from '../landscapes/model.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { rewriteLiveKeys } from '../live/rekey.js';
import { findOwnerHome } from '../projects/projects.service.js';
import { CredentialsService } from './credentials.service.js';

const FLAG = 'migration.envBeszel';
/** The source id the env-configured hub used, so the prefix of old live keys. */
const OLD_SOURCE = 'beszel';

/**
 * One-time move of the `BESZEL_*` login from before credentials existed into
 * a "Beszel" credential. Every project with landscapes bound to it gets its
 * own copy (credentials never cross projects), the owner's personal project
 * always gets one, and the bound keys are rewritten to the new credential.
 * All in one transaction: a failed run leaves nothing behind and retries on
 * the next start. Started by `StartupMigrations`.
 */
@Injectable()
export class EnvBeszelMigration {
  private readonly logger = new Logger('EnvBeszel');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly credentials: CredentialsService,
    private readonly sources: LiveSourcesService
  ) {}

  async runIfPending(): Promise<void> {
    const live = this.config.live;
    if (!live.ok) {
      if (live.reason) this.logger.warn(`BESZEL_* is set but ignored: ${live.reason}`);
      return;
    }
    const home = await findOwnerHome(this.db);
    if (!home) return; // Waits for the first-run setup.

    const { data } = this.credentials.seal(beszelConnector.id, live.config.beszel);
    const moved = await this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(meta)
        .values({ key: FLAG, value: { at: new Date().toISOString() } })
        .onConflictDoNothing()
        .returning({ key: meta.key });
      if (claimed.length === 0) return null;

      const bound = await tx
        .select({ id: landscape.id, projectId: landscape.projectId, model: landscape.model })
        .from(landscape)
        .where(sql`${landscape.model}::text like ${`%"${OLD_SOURCE}:%`}`);

      // One credential per project that needs it; ids are picked first so
      // a landscape whose text merely mentions "beszel:" creates nothing.
      const credentialFor = new Map<string, string>([[home.projectId, randomUUID()]]);
      const rewrites: { id: string; model: unknown; credentialId: string }[] = [];
      for (const row of bound) {
        const parsed = landscapeModelSchema.safeParse(row.model);
        if (!parsed.success) continue;
        const credentialId = credentialFor.get(row.projectId) ?? randomUUID();
        const { model, changed } = rewriteLiveKeys(parsed.data, OLD_SOURCE, credentialId);
        if (!changed) continue;
        credentialFor.set(row.projectId, credentialId);
        rewrites.push({ id: row.id, model, credentialId });
      }

      await tx.insert(credential).values(
        [...credentialFor].map(([projectId, id]) => ({
          id,
          projectId,
          name: 'Beszel',
          type: beszelConnector.id,
          data,
          createdBy: home.ownerId,
          updatedBy: home.ownerId
        }))
      );
      for (const rewrite of rewrites) {
        await tx
          .update(landscape)
          .set({ model: rewrite.model, version: sql`${landscape.version} + 1`, updatedAt: new Date() })
          .where(eq(landscape.id, rewrite.id));
      }
      if (rewrites.length > 0) {
        await tx
          .insert(landscapeSource)
          .values(rewrites.map(({ id, credentialId }) => ({ landscapeId: id, credentialId })));
      }
      return { credentials: credentialFor.size, rebound: rewrites.length };
    });
    if (!moved) return;

    await this.sources.refresh();
    this.logger.log(
      `Moved the BESZEL_* login into ${moved.credentials} "Beszel" credential(s); ` +
        `${moved.rebound} landscape(s) now use it. You can remove BESZEL_* from the environment.`
    );
  }
}
