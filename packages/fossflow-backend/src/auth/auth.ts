import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { z } from 'zod';
import { personName } from '../common/validation.js';
import type { AppConfig } from '../config/config.js';
import type { Database } from '../database/database.module.js';
import * as schema from '../database/schema.js';
import type { Mailer } from '../mail/mailer.js';
import { passwordSchema } from './password-policy.js';

export const AUTH = Symbol('AUTH');

/** Where the app's reset page lives; the token is appended as `?token=`. */
export const resetPasswordPage = (config: AppConfig) => `${config.publicUrl}/reset-password`;

/**
 * better-auth handles identity only: email and password, sessions, password
 * resets. Roles and projects live in our own tables (n8n's model). Public
 * sign-up is off; accounts come from owner setup and invitations.
 */
export function createAuth(options: {
  db: Database;
  config: AppConfig;
  secret: string;
  mailer: Mailer;
}) {
  const { config, mailer } = options;

  return betterAuth({
    appName: 'FossFLOW',
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: [new URL(config.publicUrl).origin],
    database: drizzleAdapter(options.db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendPasswordReset(user.email, url);
      }
    },
    user: {
      additionalFields: {
        instanceRole: {
          type: 'string',
          required: true,
          defaultValue: 'global:member',
          input: false
        }
      }
    },
    advanced: {
      cookiePrefix: 'fossflow',
      // nginx overwrites X-Real-IP on every request, so clients can't spoof it.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] }
    },
    rateLimit: { enabled: true, window: 60, max: 100 },
    hooks: {
      // better-auth's own routes only know a length rule; ours apply on top.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/reset-password' || ctx.path === '/change-password') {
          check(passwordSchema, ctx.body?.newPassword);
        }
        if (ctx.path === '/update-user' && ctx.body?.name !== undefined) {
          const name = check(personName, ctx.body.name);
          // better-auth merges a returned context into the request's; only the body changes.
          return { context: { body: { ...ctx.body, name } } };
        }
      })
    }
  });
}

/** Parses a value or answers 400 with the rule, never the value. */
function check<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new APIError('BAD_REQUEST', { message: result.error.issues[0]?.message ?? 'Invalid value' });
  }
  return result.data;
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
