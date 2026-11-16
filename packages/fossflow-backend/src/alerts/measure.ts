import { eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { alertRule, ingestGap } from '../database/schema.js';
import { emptyHistogram, percentileMs } from '../traffic/histogram.js';
import { GAP_MS } from './heartbeat.js';
import { matchesIdentity } from './targets.js';

export type RuleRow = typeof alertRule.$inferSelect;

export interface Measurement {
  status: 'met' | 'clear' | 'unknown';
  /** The failed percent, the p95 in ms, or the minutes of silence. */
  value: number | null;
  calls: number | null;
  /** Silent rules only: how long the target has been quiet. */
  sinceMinutes: number | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The window query reaches back to the longest rule window (60 minutes). */
const WINDOW_MINUTES = 60;
const ALIAS_DAYS = 1;
const LAST_SEEN_DAYS = 8;
const SLOW_QUANTILE = 0.95;

const floorTo = (ms: number, unit: number): number => Math.floor(ms / unit) * unit;
const toMs = (value: Date | string): number => new Date(value).getTime();

const UNKNOWN: Measurement = { status: 'unknown', value: null, calls: null, sinceMinutes: null };

type Identity = { kind: 'call' | 'incoming'; caller: string; callee: string };

type WindowRow = Identity & { minute: Date | string; calls: number; failures: number; histogram: number[] };

type SeenRow = Identity & { seen: Date | string };

/** `host:<name>` to `service:<name>` for hosts only one service claimed in the last 24 hours. */
async function unambiguousAliases(db: Database, projectId: string, now: Date): Promise<Map<string, string>> {
  const result = await db.execute<{ host: string; service: string }>(sql`
    select host, min(service) as service from traffic_alias
    where project_id = ${projectId} and last_seen_at >= ${new Date(now.getTime() - ALIAS_DAYS * DAY_MS)}::timestamptz
    group by host
    having count(distinct service) = 1
  `);
  return new Map(result.rows.map((row) => [`host:${row.host}`, `service:${row.service}`]));
}

function matches(rule: RuleRow, row: Identity, aliases: ReadonlyMap<string, string>): boolean {
  const { target } = rule;
  if (target.type === 'arrow') {
    if (row.kind !== 'call' || !matchesIdentity(target.from, row.caller)) return false;
    if (matchesIdentity(target.to, row.callee)) return true;
    const service = aliases.get(row.callee);
    return service !== undefined && matchesIdentity(target.to, service);
  }
  if (target.identity.startsWith('service:')) {
    return row.kind === 'incoming' && matchesIdentity(target.identity, row.callee);
  }
  return row.kind === 'call' && matchesIdentity(target.identity, row.callee);
}

function measureWindow(
  rule: RuleRow,
  rows: readonly WindowRow[],
  aliases: ReadonlyMap<string, string>,
  from: number
): Measurement {
  let calls = 0;
  let failures = 0;
  const histogram = emptyHistogram();
  for (const row of rows) {
    if (toMs(row.minute) < from || !matches(rule, row, aliases)) continue;
    calls += row.calls;
    failures += row.failures;
    row.histogram.forEach((count, index) => {
      histogram[index] = (histogram[index] ?? 0) + count;
    });
  }
  if (calls < rule.minCalls || rule.threshold === null) return UNKNOWN;
  const value = rule.kind === 'slow' ? percentileMs(histogram, SLOW_QUANTILE) : (failures / calls) * 100;
  if (value === null) return UNKNOWN;
  return { status: value >= rule.threshold ? 'met' : 'clear', value, calls, sinceMinutes: null };
}

/** The latest moment a matching call was seen, as the end of its minute (or hour for older data). */
async function lastSeenPerRule(
  db: Database,
  projectId: string,
  rules: readonly RuleRow[],
  aliases: ReadonlyMap<string, string>,
  now: Date
): Promise<Map<string, number>> {
  const hourCut = floorTo(now.getTime(), HOUR_MS) - HOUR_MS;
  const [minutes, hours] = await Promise.all([
    db.execute<SeenRow>(sql`
      select kind, caller, callee, max(minute) as seen from traffic_minute
      where project_id = ${projectId} and minute >= ${new Date(hourCut)}::timestamptz
      group by kind, caller, callee
    `),
    db.execute<SeenRow>(sql`
      select kind, caller, callee, max(hour) as seen from traffic_hour
      where project_id = ${projectId}
        and hour >= ${new Date(now.getTime() - LAST_SEEN_DAYS * DAY_MS)}::timestamptz
        and hour < ${new Date(hourCut)}::timestamptz
      group by kind, caller, callee
    `)
  ]);
  const seen: Array<{ row: Identity; at: number }> = [
    ...minutes.rows.map((row) => ({ row, at: toMs(row.seen) + MINUTE_MS })),
    ...hours.rows.map((row) => ({ row, at: toMs(row.seen) + HOUR_MS }))
  ];
  const latest = new Map<string, number>();
  for (const rule of rules) {
    for (const { row, at } of seen) {
      if (matches(rule, row, aliases) && at > (latest.get(rule.id) ?? 0)) latest.set(rule.id, at);
    }
  }
  return latest;
}

async function measureSilent(
  db: Database,
  projectId: string,
  rules: readonly RuleRow[],
  aliases: ReadonlyMap<string, string>,
  now: Date
): Promise<Map<string, Measurement>> {
  const [lastSeen, gapRows] = await Promise.all([
    lastSeenPerRule(db, projectId, rules, aliases, now),
    db
      .select({ from: ingestGap.from, to: ingestGap.to })
      .from(ingestGap)
      .where(gte(ingestGap.to, new Date(now.getTime() - LAST_SEEN_DAYS * DAY_MS)))
  ]);
  const gapEnds = gapRows
    .filter((gap) => gap.to.getTime() - gap.from.getTime() > GAP_MS)
    .map((gap) => gap.to.getTime());

  const result = new Map<string, Measurement>();
  for (const rule of rules) {
    const seen = lastSeen.get(rule.id);
    if (seen === undefined && rule.armedAt === null) {
      result.set(rule.id, UNKNOWN);
      continue;
    }
    if (rule.armedAt === null) {
      await db.update(alertRule).set({ armedAt: now }).where(eq(alertRule.id, rule.id));
    }
    // Without any call in reach, the silence is counted from when the rule was armed.
    const base = seen ?? rule.armedAt?.getTime() ?? now.getTime();
    const since = Math.max(base, ...gapEnds.filter((end) => end > base));
    const minutes = Math.max(0, Math.floor((now.getTime() - since) / MINUTE_MS));
    result.set(rule.id, {
      status: minutes >= rule.windowMinutes ? 'met' : 'clear',
      value: minutes,
      calls: null,
      sinceMinutes: minutes
    });
  }
  return result;
}

/**
 * Measures every given rule of one project at `now`: one query for the last
 * hour of minute rows serves all failing and slow rules; silent rules add a
 * last-seen query. Rules that cannot be judged yet are `unknown`.
 */
export async function measureProject(
  db: Database,
  projectId: string,
  rules: readonly RuleRow[],
  now: Date
): Promise<Map<string, Measurement>> {
  const result = new Map<string, Measurement>();
  if (rules.length === 0) return result;
  const aliases = await unambiguousAliases(db, projectId, now);

  const windowed = rules.filter((rule) => rule.kind !== 'silent');
  if (windowed.length > 0) {
    const minute = floorTo(now.getTime(), MINUTE_MS);
    const rows = await db.execute<WindowRow>(sql`
      select kind, caller, callee, minute, sum(calls)::int as calls, sum(failures)::int as failures,
        int_array_sum(histogram) as histogram
      from traffic_minute
      where project_id = ${projectId} and minute >= ${new Date(minute - (WINDOW_MINUTES - 1) * MINUTE_MS)}::timestamptz
        and minute <= ${new Date(minute)}::timestamptz
      group by kind, caller, callee, minute
    `);
    for (const rule of windowed) {
      result.set(rule.id, measureWindow(rule, rows.rows, aliases, minute - (rule.windowMinutes - 1) * MINUTE_MS));
    }
  }

  const silent = rules.filter((rule) => rule.kind === 'silent');
  if (silent.length > 0) {
    for (const [id, measurement] of await measureSilent(db, projectId, silent, aliases, now)) {
      result.set(id, measurement);
    }
  }
  return result;
}
