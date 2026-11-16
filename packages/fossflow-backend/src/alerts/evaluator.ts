import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { alertEvent, alertRule } from '../database/schema.js';
import { describeError } from '../traffic/errors.js';
import { DELIVERIES, type Deliveries } from './deliveries.token.js';
import { IngestHeartbeat } from './heartbeat.js';
import { type Measurement, measureProject, type RuleRow } from './measure.js';

const logger = new Logger('AlertEvaluator');

export const EVALUATE_MS = 60_000;
/** While an alert keeps firing, its channels hear about it this often. */
export const REMIND_MS = 4 * 3_600_000;
/** The condition must stay clear this long before an alert resolves. */
export const RESOLVE_MS = 3 * 60_000;

export interface TickResult {
  started: string[];
  reminded: string[];
  resolved: string[];
}

type OpenEvent = typeof alertEvent.$inferSelect;
type State = 'firing' | 'reminder' | 'resolved';

/** Checks every enabled rule once a minute and moves it between ok and firing. */
@Injectable()
export class AlertEvaluator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  /** False while the start of this run has not been recorded; ticks keep trying and do not beat meanwhile. */
  private startRecorded = true;
  private bootedAt = new Date();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(IngestHeartbeat) private readonly heartbeat: IngestHeartbeat,
    @Inject(DELIVERIES) private readonly deliveries: Deliveries
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.bootedAt = new Date();
    this.startRecorded = false;
    await this.recordStart();
    if (this.startRecorded) await this.beat(this.bootedAt);
    this.timer = setInterval(() => void this.run(), EVALUATE_MS);
    this.timer.unref();
  }

  beforeApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async recordStart(): Promise<void> {
    try {
      await this.heartbeat.recordStart(this.bootedAt);
      this.startRecorded = true;
    } catch (error) {
      logger.warn(`Recording the ingest start failed, will retry (${describeError(error)})`);
    }
  }

  private async beat(now: Date): Promise<void> {
    try {
      await this.heartbeat.beat(now);
    } catch (error) {
      logger.warn(`Writing the heartbeat failed (${describeError(error)})`);
    }
  }

  /** One evaluation of every enabled rule; returns the ids of the rules that changed state. */
  async tick(now: Date = new Date()): Promise<TickResult> {
    const result: TickResult = { started: [], reminded: [], resolved: [] };
    if (!this.startRecorded) await this.recordStart();
    // Beating before the start is recorded would overwrite the heartbeat the gap is measured from.
    if (this.startRecorded) await this.beat(now);

    const rules = await this.db.select().from(alertRule).where(eq(alertRule.enabled, true));
    if (rules.length === 0) return result;
    const open = await this.db
      .select()
      .from(alertEvent)
      .where(
        and(
          isNull(alertEvent.resolvedAt),
          inArray(
            alertEvent.ruleId,
            rules.map((rule) => rule.id)
          )
        )
      );
    const openByRule = new Map(open.map((event) => [event.ruleId, event]));

    const byProject = new Map<string, RuleRow[]>();
    for (const rule of rules) byProject.set(rule.projectId, [...(byProject.get(rule.projectId) ?? []), rule]);

    for (const [projectId, projectRules] of byProject) {
      let measurements: Map<string, Measurement>;
      try {
        measurements = await measureProject(this.db, projectId, projectRules, now);
      } catch (error) {
        logger.warn(`Measuring alert rules failed, will retry (${describeError(error)})`);
        continue;
      }
      for (const rule of projectRules) {
        const measurement = measurements.get(rule.id);
        if (!measurement) continue;
        try {
          await this.apply(rule, measurement, openByRule.get(rule.id), now, result);
        } catch (error) {
          logger.warn(`Updating an alert failed, will retry (${describeError(error)})`);
        }
      }
    }
    return result;
  }

  private async apply(
    rule: RuleRow,
    measurement: Measurement,
    event: OpenEvent | undefined,
    now: Date,
    result: TickResult
  ): Promise<void> {
    if (measurement.status === 'unknown') return;
    if (measurement.status === 'met') {
      if (!event) {
        const [created] = await this.db
          .insert(alertEvent)
          .values({
            ruleId: rule.id,
            projectId: rule.projectId,
            startedAt: now,
            lastNotifiedAt: now,
            value: measurement.value
          })
          .returning({ id: alertEvent.id });
        if (!created) return;
        result.started.push(rule.id);
        this.notify(created.id, 'firing');
        return;
      }
      const remind = now.getTime() - event.lastNotifiedAt.getTime() >= REMIND_MS;
      await this.db
        .update(alertEvent)
        .set({ value: measurement.value, clearSince: null, ...(remind ? { lastNotifiedAt: now } : {}) })
        .where(eq(alertEvent.id, event.id));
      if (remind) {
        result.reminded.push(rule.id);
        this.notify(event.id, 'reminder');
      }
      return;
    }
    if (!event) return;
    if (event.clearSince === null) {
      await this.db.update(alertEvent).set({ clearSince: now }).where(eq(alertEvent.id, event.id));
    } else if (now.getTime() - event.clearSince.getTime() >= RESOLVE_MS) {
      await this.db.update(alertEvent).set({ resolvedAt: now }).where(eq(alertEvent.id, event.id));
      result.resolved.push(rule.id);
      this.notify(event.id, 'resolved');
    }
  }

  /** Fire and forget: a failing sender must neither slow a tick nor surface as an unhandled rejection. */
  private notify(eventId: number, state: State): void {
    const failed = (error: unknown): void => logger.warn(`Notifying channels failed (${describeError(error)})`);
    try {
      this.deliveries.notify(String(eventId), state).catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      logger.warn(`Alert evaluation failed, will retry (${describeError(error)})`);
    } finally {
      this.running = false;
    }
  }
}
