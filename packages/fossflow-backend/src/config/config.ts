import { z } from 'zod';
import { readLiveConfig, type LiveConfigResult } from '../live/config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  from: string;
}

export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  /** Where people open FossFLOW, without a trailing slash (may include a sub-path). Used for links. */
  publicUrl: string;
  /** Holds the generated encryption key (and legacy data to import). */
  dataDir: string;
  /** Optional 32-byte master key (base64). When unset, one is generated in dataDir. */
  encryptionKey: string | undefined;
  /** Optional: without it, invite and reset links are only shown to admins. */
  smtp: SmtpConfig | null;
  /** Environment-configured live source. Replaced by credentials in phase 1, milestone 5. */
  live: LiveConfigResult;
}

const optional = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const envSchema = z.object({
  DATABASE_URL: z
    .string({
      error: (issue) => (issue.input === undefined ? 'is required' : 'must be text')
    })
    .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection URL'),
  BACKEND_HOST: z.string().min(1).default('127.0.0.1'),
  BACKEND_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  FOSSFLOW_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('http://localhost:3000'),
  FOSSFLOW_DATA_DIR: z.string().min(1).default('./data'),
  FOSSFLOW_ENCRYPTION_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(465),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  SMTP_FROM: optional
});

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Validates the environment once at startup. Messages name the variable and
 * the rule, never the value: several variables carry passwords.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid configuration: ${problems}`);
  }
  const data = parsed.data;

  if (data.SMTP_HOST && !data.SMTP_FROM) {
    throw new ConfigError('Invalid configuration: SMTP_FROM is required when SMTP_HOST is set');
  }

  return {
    databaseUrl: data.DATABASE_URL,
    host: data.BACKEND_HOST,
    port: data.BACKEND_PORT,
    publicUrl: data.FOSSFLOW_URL.replace(/\/+$/, ''),
    dataDir: data.FOSSFLOW_DATA_DIR,
    encryptionKey: data.FOSSFLOW_ENCRYPTION_KEY,
    smtp:
      data.SMTP_HOST && data.SMTP_FROM
        ? {
            host: data.SMTP_HOST,
            port: data.SMTP_PORT,
            secure: data.SMTP_SECURE ? data.SMTP_SECURE === 'true' : data.SMTP_PORT === 465,
            user: data.SMTP_USER,
            password: data.SMTP_PASSWORD,
            from: data.SMTP_FROM
          }
        : null,
    live: readLiveConfig(env)
  };
}
