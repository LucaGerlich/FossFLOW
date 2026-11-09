import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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

/**
 * A project holds landscapes and credentials (n8n's model). Everyone has one
 * personal project; team projects are created by owners and admins.
 */
export const project = pgTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['personal', 'team'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

/** Membership: one role per user per project. */
export const projectRelation = pgTable(
  'project_relation',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_relation_user_idx').on(table.userId),
    // At most one personal project per user.
    uniqueIndex('project_relation_one_personal_idx')
      .on(table.userId)
      .where(sql`${table.role} = 'project:personalOwner'`)
  ]
);
