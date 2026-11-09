import { z } from 'zod';
import { readLiveConfig, type LiveConfigResult } from '../live/config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  /** Environment-configured live source. Replaced by credentials in phase 1, milestone 5. */
  live: LiveConfigResult;
}

const envSchema = z.object({
  DATABASE_URL: z
    .string({
      error: (issue) => (issue.input === undefined ? 'is required' : 'must be text')
    })
    .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection URL'),
  BACKEND_HOST: z.string().min(1).default('127.0.0.1'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65_535).default(3001)
});

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Validates the environment once at startup. Messages name the variable and
 * the rule, never the value: DATABASE_URL carries the database password.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${problems}`);
  }

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    host: parsed.data.BACKEND_HOST,
    port: parsed.data.BACKEND_PORT,
    live: readLiveConfig(env)
  };
}
