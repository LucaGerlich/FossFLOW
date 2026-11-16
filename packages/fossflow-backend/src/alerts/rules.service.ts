import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { parseBody } from '../common/validation.js';
import { findConnector } from '../connectors/registry.js';
import { DB, type Database } from '../database/database.module.js';
import { alertEvent, alertRule, credential } from '../database/schema.js';
import { MAX_RULES_PER_PROJECT, type RuleInput, type RulePatch, ruleInputSchema } from './rule-input.js';
import type { AlertEventView, AlertRuleView, DeliveryRecord } from './types.js';

type RuleRow = typeof alertRule.$inferSelect;

export interface AlertEventQuery {
  state: 'active' | 'resolved';
  before?: number;
  limit: number;
}

const toInput = (row: RuleRow): Record<string, unknown> => ({
  name: row.name,
  kind: row.kind,
  target: row.target,
  threshold: row.threshold,
  windowMinutes: row.windowMinutes,
  minCalls: row.minCalls,
  channelIds: row.channelIds,
  enabled: row.enabled
});

function viewOf(row: RuleRow, activeSince: Date | null): AlertRuleView {
  const waiting = row.kind === 'silent' && row.armedAt === null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    target: row.target,
    threshold: row.threshold,
    windowMinutes: row.windowMinutes,
    minCalls: row.minCalls,
    channelIds: row.channelIds,
    enabled: row.enabled,
    state: activeSince ? 'firing' : waiting ? 'waiting' : 'ok',
    activeSince: activeSince?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

@Injectable()
export class RulesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(projectId: string): Promise<AlertRuleView[]> {
    const rows = await this.db
      .select()
      .from(alertRule)
      .where(eq(alertRule.projectId, projectId))
      .orderBy(alertRule.createdAt, alertRule.id);
    const open = await this.openSince(rows.map((row) => row.id));
    return rows.map((row) => viewOf(row, open.get(row.id) ?? null));
  }

  async create(projectId: string, userId: string, input: RuleInput): Promise<AlertRuleView> {
    const [existing] = await this.db
      .select({ total: count() })
      .from(alertRule)
      .where(eq(alertRule.projectId, projectId));
    if ((existing?.total ?? 0) >= MAX_RULES_PER_PROJECT) {
      throw new ConflictException({ error: `This project already has ${MAX_RULES_PER_PROJECT} alert rules` });
    }
    const channelIds = await this.checkChannels(projectId, input.channelIds);
    const [row] = await this.db
      .insert(alertRule)
      .values({
        id: randomUUID(),
        projectId,
        name: input.name,
        kind: input.kind,
        target: input.target,
        threshold: input.kind === 'silent' ? null : (input.threshold ?? null),
        windowMinutes: input.windowMinutes,
        minCalls: input.minCalls,
        channelIds,
        enabled: input.enabled,
        createdBy: userId
      })
      .returning();
    if (!row) throw new Error('alert rule was not saved');
    return viewOf(row, null);
  }

  async update(id: string, patch: RulePatch): Promise<AlertRuleView> {
    const [row] = await this.db.select().from(alertRule).where(eq(alertRule.id, id));
    if (!row) throw new NotFoundException({ error: 'Alert rule not found' });
    const kind = patch.kind ?? row.kind;
    const merged = parseBody(ruleInputSchema, {
      ...toInput(row),
      ...patch,
      kind,
      // Switching to silent drops the old threshold unless the request says otherwise.
      threshold: patch.threshold !== undefined ? patch.threshold : kind === 'silent' ? null : row.threshold
    });
    const channelIds = await this.checkChannels(row.projectId, merged.channelIds);
    const retargeted =
      JSON.stringify(merged.target) !== JSON.stringify(row.target) || merged.kind !== row.kind;
    const [saved] = await this.db.transaction(async (tx) => {
      if (!merged.enabled) await this.closeOpen(tx, id);
      return tx
        .update(alertRule)
        .set({
          name: merged.name,
          kind: merged.kind,
          target: merged.target,
          threshold: merged.kind === 'silent' ? null : (merged.threshold ?? null),
          windowMinutes: merged.windowMinutes,
          minCalls: merged.minCalls,
          channelIds,
          enabled: merged.enabled,
          // A silent rule waits again when it now watches something else.
          ...(retargeted ? { armedAt: null } : {}),
          updatedAt: new Date()
        })
        .where(eq(alertRule.id, id))
        .returning();
    });
    if (!saved) throw new NotFoundException({ error: 'Alert rule not found' });
    const open = await this.openSince([id]);
    return viewOf(saved, open.get(id) ?? null);
  }

  /** Deleting a rule removes its events with it (cascade); nothing is sent. */
  async remove(id: string): Promise<void> {
    const removed = await this.db.delete(alertRule).where(eq(alertRule.id, id)).returning({ id: alertRule.id });
    if (removed.length === 0) throw new NotFoundException({ error: 'Alert rule not found' });
  }

  async events(projectId: string, query: AlertEventQuery): Promise<AlertEventView[]> {
    const open = query.state === 'active';
    const rows = await this.db
      .select({ event: alertEvent, rule: alertRule })
      .from(alertEvent)
      .innerJoin(alertRule, eq(alertRule.id, alertEvent.ruleId))
      .where(
        and(
          eq(alertEvent.projectId, projectId),
          open ? isNull(alertEvent.resolvedAt) : isNotNull(alertEvent.resolvedAt),
          !open && query.before !== undefined ? lt(alertEvent.id, query.before) : undefined
        )
      )
      // Resolved events page by id, so they come in id order; open ones are few and go by start.
      .orderBy(...(open ? [desc(alertEvent.startedAt), desc(alertEvent.id)] : [desc(alertEvent.id)]))
      .limit(query.limit);
    return rows.map(({ event, rule }) => ({
      id: String(event.id),
      ruleId: rule.id,
      ruleName: rule.name,
      kind: rule.kind,
      target: rule.target,
      startedAt: event.startedAt.toISOString(),
      resolvedAt: event.resolvedAt?.toISOString() ?? null,
      value: event.value,
      deliveries: event.deliveries satisfies DeliveryRecord[]
    }));
  }

  /** Ends the open event quietly: no message goes out. */
  private async closeOpen(tx: Pick<Database, 'update'>, ruleId: string): Promise<void> {
    await tx
      .update(alertEvent)
      .set({ resolvedAt: new Date() })
      .where(and(eq(alertEvent.ruleId, ruleId), isNull(alertEvent.resolvedAt)));
  }

  private async openSince(ruleIds: string[]): Promise<Map<string, Date>> {
    if (ruleIds.length === 0) return new Map();
    const rows = await this.db
      .select({ ruleId: alertEvent.ruleId, startedAt: alertEvent.startedAt })
      .from(alertEvent)
      .where(and(inArray(alertEvent.ruleId, ruleIds), isNull(alertEvent.resolvedAt)));
    return new Map(rows.map((row) => [row.ruleId, row.startedAt]));
  }

  /** Every channel must be a channel credential of this project; the error never echoes an id. */
  private async checkChannels(projectId: string, requested: string[]): Promise<string[]> {
    const ids = [...new Set(requested)];
    if (ids.length === 0) return ids;
    const rows = await this.db
      .select({ id: credential.id, type: credential.type })
      .from(credential)
      .where(and(eq(credential.projectId, projectId), inArray(credential.id, ids)));
    const valid = new Set(rows.filter((row) => findConnector(row.type)?.kind === 'channel').map((row) => row.id));
    if (ids.some((id) => !valid.has(id))) {
      throw new BadRequestException({
        error: 'Every channel must be a channel credential of this project',
        issues: [{ path: 'channelIds', message: 'Every channel must be a channel credential of this project' }]
      });
    }
    return ids;
  }
}
