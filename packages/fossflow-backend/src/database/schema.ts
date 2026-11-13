import { sql } from 'drizzle-orm';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
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

/**
 * A landscape (n8n's workflow): one FossFLOW model stored in a project.
 * `version` increases with every save; a save based on an older version is
 * refused, so nobody silently overwrites someone else's changes.
 */
export const landscape = pgTable(
  'landscape',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    model: jsonb('model').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('landscape_project_idx').on(table.projectId)]
);

/**
 * Login data for a live source (n8n's credential). `data` holds the
 * connector's settings sealed with AES-256-GCM; it is never returned.
 */
export const credential = pgTable(
  'credential',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The connector, e.g. `beszel`. */
    type: text('type').notNull(),
    data: text('data').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('credential_project_idx').on(table.projectId)]
);

/** Which credentials' live data a landscape shows. */
export const landscapeSource = pgTable(
  'landscape_source',
  {
    landscapeId: text('landscape_id')
      .notNull()
      .references(() => landscape.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => credential.id, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.landscapeId, table.credentialId] }),
    index('landscape_source_credential_idx').on(table.credentialId)
  ]
);

/**
 * A key a service uses to send traces to a project. Only a hash of the key is
 * stored; `prefix` is the first characters, shown so people can tell keys apart.
 */
export const ingestKey = pgTable(
  'ingest_key',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
  },
  (table) => [index('ingest_key_project_idx').on(table.projectId)]
);

/** The service names seen on each ingest key. */
export const ingestService = pgTable(
  'ingest_service',
  {
    keyId: text('key_id')
      .notNull()
      .references(() => ingestKey.id, { onDelete: 'cascade' }),
    serviceName: text('service_name').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.keyId, table.serviceName] })]
);

const trafficKind = (name: string) => text(name, { enum: ['call', 'incoming'] }).notNull();

/** Call counts per minute; `caller` is '' for traffic entering a service. */
export const trafficMinute = pgTable(
  'traffic_minute',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: trafficKind('kind'),
    caller: text('caller').notNull(),
    callee: text('callee').notNull(),
    operation: text('operation').notNull(),
    minute: timestamp('minute', { withTimezone: true }).notNull(),
    calls: integer('calls').notNull(),
    failures: integer('failures').notNull(),
    durationSumMs: doublePrecision('duration_sum_ms').notNull(),
    histogram: integer('histogram').array().notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.kind, table.caller, table.callee, table.operation, table.minute]
    }),
    index('traffic_minute_project_minute_idx').on(table.projectId, table.minute),
    index('traffic_minute_minute_idx').on(table.minute)
  ]
);

/** The same counts rolled up per hour, kept longer. */
export const trafficHour = pgTable(
  'traffic_hour',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: trafficKind('kind'),
    caller: text('caller').notNull(),
    callee: text('callee').notNull(),
    operation: text('operation').notNull(),
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    calls: integer('calls').notNull(),
    failures: integer('failures').notNull(),
    durationSumMs: doublePrecision('duration_sum_ms').notNull(),
    histogram: integer('histogram').array().notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.kind, table.caller, table.callee, table.operation, table.hour]
    }),
    index('traffic_hour_project_hour_idx').on(table.projectId, table.hour),
    index('traffic_hour_hour_idx').on(table.hour)
  ]
);

/** Individual failed calls, kept briefly for troubleshooting. */
export const trafficFailure = pgTable(
  'traffic_failure',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: trafficKind('kind'),
    caller: text('caller').notNull(),
    callee: text('callee').notNull(),
    operation: text('operation').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    durationMs: doublePrecision('duration_ms').notNull(),
    status: text('status').notNull()
  },
  (table) => [
    index('traffic_failure_edge_idx').on(table.projectId, table.caller, table.callee, table.at),
    index('traffic_failure_at_idx').on(table.at)
  ]
);

/** Which service a host name (as seen in client spans) belongs to. */
export const trafficAlias = pgTable(
  'traffic_alias',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    service: text('service').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull()
  },
  (table) => [primaryKey({ columns: [table.projectId, table.host, table.service] })]
);
