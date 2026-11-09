import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';

export * from './auth-schema.js';

/** Instance-level flags, e.g. which one-time data migrations have run. */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

/**
 * An invitation to join the instance. Only a SHA-256 hash of the link's token
 * is stored; accepting sets `acceptedAt`, so a link works once.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    instanceRole: text('instance_role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true })
  },
  (table) => [index('invitation_email_idx').on(table.email)]
);
