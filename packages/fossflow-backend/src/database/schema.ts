import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Instance-level flags, e.g. which one-time data migrations have run. */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});
