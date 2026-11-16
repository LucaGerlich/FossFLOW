import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { type AlertMessage } from '../connectors/channels/message.js';
import type { SendResult } from '../connectors/channels/types.js';
import type { ChannelConnector } from '../connectors/connector.js';
import { POST_JSON, type postJson } from '../connectors/outbound.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { DB, type Database } from '../database/database.module.js';
import { alertEvent, alertRule, project } from '../database/schema.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { describeError } from '../traffic/errors.js';
import type { Deliveries } from './deliveries.token.js';
import { measureProject } from './measure.js';
import type { DeliveryRecord } from './types.js';

const logger = new Logger('AlertDeliveries');

/** Injection token for the wait between attempts, so tests need not wait. */
export const DELIVERY_SLEEP = Symbol('DELIVERY_SLEEP');
export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 3;
/** The wait after the first and the second failed attempt. */
const BACKOFF_MS = [2000, 8000] as const;
/** A longer Retry-After than this and the delivery gives up. */
const MAX_RETRY_AFTER_S = 60;
/** The deliveries an event remembers. */
const KEEP_DELIVERIES = 50;
const MINUTE_MS = 60_000;

type State = 'firing' | 'reminder' | 'resolved';
type Outcome = Pick<DeliveryRecord, 'ok' | 'status' | 'error' | 'attempts'>;

/** How long to wait before the next attempt; null when the delivery should give up. */
function waitBefore(result: SendResult, attempt: number): number | null {
  const { status, retryAfterSeconds } = result;
  if (status === 429 && retryAfterSeconds !== null) {
    return retryAfterSeconds <= MAX_RETRY_AFTER_S ? retryAfterSeconds * 1000 : null;
  }
  if (status !== null && status >= 400 && status < 500 && status !== 429) return null;
  return BACKOFF_MS[attempt - 1] ?? null;
}

/** Sends to the channels of an event's rule, retrying, and records the outcome on the event. */
@Injectable()
export class DeliveriesService implements Deliveries {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
    @Inject(POST_JSON) private readonly post: typeof postJson,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DELIVERY_SLEEP) private readonly wait: Sleep
  ) {}

  async notify(eventId: string, state: State): Promise<void> {
    const [row] = await this.db
      .select({ event: alertEvent, rule: alertRule, projectName: project.name })
      .from(alertEvent)
      .innerJoin(alertRule, eq(alertRule.id, alertEvent.ruleId))
      .innerJoin(project, eq(project.id, alertEvent.projectId))
      .where(eq(alertEvent.id, Number(eventId)));
    if (!row || row.rule.channelIds.length === 0) return;

    const message = await this.buildMessage(row.event, row.rule, row.projectName, state);
    const at = new Date().toISOString();
    const records = await Promise.all(
      row.rule.channelIds.map((channelId) => this.deliver(channelId, message, state, at))
    );
    await this.append(row.event.id, records);
  }

  private async buildMessage(
    event: typeof alertEvent.$inferSelect,
    rule: typeof alertRule.$inferSelect,
    projectName: string,
    state: State
  ): Promise<AlertMessage> {
    return {
      state,
      kind: rule.kind,
      ruleId: rule.id,
      ruleName: rule.name,
      projectName,
      target: rule.target,
      value: event.value,
      threshold: rule.kind === 'silent' ? rule.windowMinutes : rule.threshold,
      windowMinutes: rule.windowMinutes,
      calls: state === 'resolved' ? null : await this.callsFor(rule),
      sinceMinutes: rule.kind === 'silent' ? event.value : null,
      startedAt: event.startedAt.toISOString(),
      durationMinutes: event.resolvedAt
        ? (event.resolvedAt.getTime() - event.startedAt.getTime()) / MINUTE_MS
        : null,
      url: `${this.config.publicUrl}/projects/${rule.projectId}/monitoring`
    };
  }

  /** The calls behind a failing or slow rule, from a fresh measure; null when it cannot be had. */
  private async callsFor(rule: typeof alertRule.$inferSelect): Promise<number | null> {
    if (rule.kind === 'silent') return null;
    try {
      const measured = await measureProject(this.db, rule.projectId, [rule], new Date());
      return measured.get(rule.id)?.calls ?? null;
    } catch (error) {
      logger.warn(`Counting the calls of an alert failed (${describeError(error)})`);
      return null;
    }
  }

  private async deliver(
    channelId: string,
    message: AlertMessage,
    state: State,
    at: string
  ): Promise<DeliveryRecord> {
    const base = { at, state, channelId };
    let loaded: { connector: ChannelConnector; settings: unknown; name: string };
    try {
      const { connector, settings, name } = await this.credentials.settingsFor(channelId);
      if (connector.kind !== 'channel') {
        return { ...base, channelName: name, ok: false, status: null, error: 'missing', attempts: 0 };
      }
      loaded = { connector, settings, name };
    } catch {
      return { ...base, channelName: null, ok: false, status: null, error: 'missing', attempts: 0 };
    }
    const outcome = await this.sendWithRetries(loaded.connector, loaded.settings, message);
    return { ...base, channelName: loaded.name, ...outcome };
  }

  private async sendWithRetries(
    connector: ChannelConnector,
    settings: unknown,
    message: AlertMessage
  ): Promise<Outcome> {
    let last: SendResult | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        last = await connector.send(settings, message, { postJson: this.post, mailer: this.mailer });
      } catch (error) {
        logger.warn(`A channel could not send (${describeError(error)})`);
        // Stored settings that no longer parse will not parse on a retry either.
        if (error instanceof ZodError) {
          return { ok: false, status: null, error: 'missing', attempts: attempt };
        }
        last = { ok: false, status: null, retryAfterSeconds: null, error: 'network' };
      }
      if (last.ok) return { ok: true, status: last.status, error: null, attempts: attempt };
      const delay = waitBefore(last, attempt);
      if (delay === null || attempt === MAX_ATTEMPTS) {
        return { ok: false, status: last.status, error: last.error, attempts: attempt };
      }
      await this.wait(delay);
    }
    return { ok: false, status: last?.status ?? null, error: last?.error ?? null, attempts: MAX_ATTEMPTS };
  }

  /** One atomic update, so parallel notifications cannot lose each other's records. */
  private async append(eventId: number, records: DeliveryRecord[]): Promise<void> {
    await this.db
      .update(alertEvent)
      .set({
        deliveries: sql`(
          select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
          from (
            select value, ordinality
            from jsonb_array_elements(${alertEvent.deliveries} || ${JSON.stringify(records)}::jsonb)
              with ordinality
            order by ordinality desc
            limit ${KEEP_DELIVERIES}
          ) entry
        )`
      })
      .where(eq(alertEvent.id, eventId));
  }
}
