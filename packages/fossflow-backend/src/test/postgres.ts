import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from '@testcontainers/postgresql';

/** Same major as compose.yml, so tests run against what users deploy. */
export const POSTGRES_IMAGE = 'postgres:18-alpine';

/** A throwaway Postgres for integration tests (needs a running Docker). */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(POSTGRES_IMAGE).start();
}
