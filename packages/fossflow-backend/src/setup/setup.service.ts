import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { meta, user } from '../database/schema.js';
import { AccountsService } from '../users/accounts.service.js';

const SETUP_KEY = 'setup.owner';

@Injectable()
export class SetupService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accounts: AccountsService
  ) {}

  async isSetupRequired(): Promise<boolean> {
    const [row] = await this.db.select({ users: count() }).from(user);
    return (row?.users ?? 0) === 0;
  }

  /**
   * Creates the first account as Owner. A row in `meta` is claimed first, so
   * two people opening a fresh instance at once can't both become owner.
   */
  async createOwner(input: { name: string; email: string; password: string }): Promise<void> {
    const claimed = await this.db
      .insert(meta)
      .values({ key: SETUP_KEY, value: { at: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning({ key: meta.key });
    if (claimed.length === 0) {
      throw new ConflictException({ error: 'This instance is already set up' });
    }

    try {
      if (!(await this.isSetupRequired())) {
        throw new ConflictException({ error: 'This instance is already set up' });
      }
      await this.accounts.createUser({ ...input, instanceRole: 'global:owner' });
    } catch (error) {
      await this.db.delete(meta).where(eq(meta.key, SETUP_KEY));
      throw error;
    }
  }
}
