import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';

/** How recently a host must have been claimed by a service to count. */
export const ALIAS_WINDOW_MS = 24 * 3_600_000;

export type HostAlias = { host: string; service: string };

/**
 * Bare host and service names for hosts that exactly one service claimed in
 * the last 24 hours. The one definition of an "unambiguous alias", shared by
 * the traffic summary and the alert rules.
 */
export async function unambiguousAliases(db: Database, projectId: string, now: Date): Promise<HostAlias[]> {
  const result = await db.execute<HostAlias>(sql`
    select host, min(service) as service from traffic_alias
    where project_id = ${projectId} and last_seen_at >= ${new Date(now.getTime() - ALIAS_WINDOW_MS)}::timestamptz
    group by host
    having count(distinct service) = 1
  `);
  return result.rows;
}
