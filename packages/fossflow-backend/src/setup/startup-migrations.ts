import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EnvBeszelMigration } from '../credentials/env-beszel-migration.js';
import { LegacyImportService } from '../landscapes/legacy-import.service.js';

/**
 * One-time moves of data from before the platform. Each waits for an owner,
 * so they run on start and again right after the first-run setup. A failure
 * is logged and never stops the server.
 */
@Injectable()
export class StartupMigrations implements OnApplicationBootstrap {
  private readonly logger = new Logger('Migrations');

  constructor(
    private readonly legacyImport: LegacyImportService,
    private readonly envBeszel: EnvBeszelMigration
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.runPending();
  }

  async runPending(): Promise<void> {
    // Old diagrams first, so their live keys get rewritten to the new credential.
    const steps: [string, () => Promise<void>][] = [
      ['Old diagrams', () => this.legacyImport.importIfPending()],
      ['The BESZEL_* login', () => this.envBeszel.runIfPending()]
    ];
    for (const [what, run] of steps) {
      try {
        await run();
      } catch (error) {
        this.logger.warn(
          `${what} could not be migrated: ${error instanceof Error ? error.message : String(error)}. ` +
            'Later steps wait for the next start.'
        );
        return;
      }
    }
  }
}
