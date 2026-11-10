import { fileURLToPath } from 'node:url';
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import * as schema from './schema.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export type Database = NodePgDatabase<typeof schema>;

/** `drizzle/` at the package root, from both `src/database` and `dist/database`. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new pg.Pool({ connectionString: config.databaseUrl })
    },
    {
      provide: DB,
      inject: [PG_POOL],
      // Migrations run before any request is served.
      useFactory: async (pool: pg.Pool): Promise<Database> => {
        const db = drizzle(pool, { schema });
        await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
        return db;
      }
    }
  ],
  exports: [DB]
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
