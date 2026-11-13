import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { trafficHour } from '../database/schema.js';

const logger = new Logger('TrafficMaintenance');

export const MAINTENANCE_MS = 10 * 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_FAILURES_PER_ARROW = 500;

const hourStart = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

/**
 * Rolls minute counts up into hours and deletes data past its retention.
 * Hours are cut in UTC explicitly, so the database's session time zone
 * (a half-hour zone, say) can never shift them.
 */
@Injectable()
export class TrafficMaintenance implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), MAINTENANCE_MS);
    this.timer.unref();
  }

  beforeApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Recomputes every complete hour from the latest rolled hour (or the start
   * of minute retention) up to the current one. Values are replaced, so a rerun
   * changes nothing and a partly rolled hour is completed.
   */
  async rollUp(now: Date): Promise<void> {
    const current = hourStart(now.getTime());
    const [latest] = await this.db
      .select({ hour: trafficHour.hour })
      .from(trafficHour)
      .orderBy(desc(trafficHour.hour))
      .limit(1);
    const from = latest ? latest.hour.getTime() : hourStart(now.getTime() - this.config.traffic.minutesDays * DAY_MS);
    if (from >= current) return;

    await this.db.execute(sql`
      insert into traffic_hour
        (project_id, kind, caller, callee, operation, hour, calls, failures, duration_sum_ms, histogram)
      select
        project_id, kind, caller, callee, operation,
        date_trunc('hour', minute, 'UTC'),
        sum(calls)::int, sum(failures)::int, sum(duration_sum_ms), int_array_sum(histogram)
      from traffic_minute
      where minute >= ${new Date(from)}::timestamptz and minute < ${new Date(current)}::timestamptz
      group by project_id, kind, caller, callee, operation, date_trunc('hour', minute, 'UTC')
      on conflict (project_id, kind, caller, callee, operation, hour) do update set
        calls = excluded.calls,
        failures = excluded.failures,
        duration_sum_ms = excluded.duration_sum_ms,
        histogram = excluded.histogram
    `);
  }

  /** Deletes data past its retention, and failures beyond the newest few per arrow. */
  async prune(now: Date): Promise<void> {
    const { minutesDays, hoursDays, failuresDays } = this.config.traffic;
    const before = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
    await this.db.execute(sql`delete from traffic_minute where minute < ${before(minutesDays)}::timestamptz`);
    await this.db.execute(sql`delete from traffic_hour where hour < ${before(hoursDays)}::timestamptz`);
    await this.db.execute(sql`delete from traffic_failure where at < ${before(failuresDays)}::timestamptz`);
    await this.db.execute(sql`
      delete from traffic_failure where id in (
        select id from (
          select id, row_number() over (
            partition by project_id, kind, caller, callee order by at desc
          ) as position
          from traffic_failure
        ) ranked
        where position > ${MAX_FAILURES_PER_ARROW}
      )
    `);
  }

  /** One scheduled pass. Failures are logged (never with row data) and retried on the next pass. */
  private async run(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.attempt('roll-up', () => this.rollUp(now));
      await this.attempt('prune', () => this.prune(now));
    } finally {
      this.running = false;
    }
  }

  private async attempt(task: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      logger.warn(`Traffic ${task} failed, will retry: ${reason}`);
    }
  }
}
