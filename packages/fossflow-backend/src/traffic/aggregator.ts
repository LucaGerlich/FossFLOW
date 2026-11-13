import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { ingestKey, ingestService, trafficAlias, trafficFailure, trafficMinute } from '../database/schema.js';
import type { IngestKeyRef } from '../ingest/ingest-keys.service.js';
import type { TrafficBatch, TrafficEvent } from '../ingest/spans.js';
import { bucketOf, emptyHistogram } from './histogram.js';

const logger = new Logger('Traffic');

export const FLUSH_MS = 5000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const CHUNK = 1000;
const MAX_FAILURES_PER_ARROW = 100;
const MAX_OPERATIONS_PER_PAIR = 200;
const MAX_PAIRS_PER_PROJECT = 1000;
const OVERFLOW_OPERATION = 'other';
const SEP = '\u0000';

type Minute = {
  kind: TrafficEvent['kind'];
  caller: string;
  callee: string;
  operation: string;
  minute: number;
  calls: number;
  failures: number;
  durationSumMs: number;
  histogram: number[];
};

type Failure = {
  kind: TrafficEvent['kind'];
  caller: string;
  callee: string;
  operation: string;
  at: number;
  durationMs: number;
  status: string;
};

type ProjectBuffer = {
  minutes: Map<string, Minute>;
  failures: Failure[];
  /** Failures buffered per arrow in this flush window. */
  failureCounts: Map<string, number>;
  aliases: Map<string, { host: string; service: string }>;
  /** Services seen per ingest key. */
  services: Map<string, Set<string>>;
};

const newBuffer = (): ProjectBuffer => ({
  minutes: new Map(),
  failures: [],
  failureCounts: new Map(),
  aliases: new Map(),
  services: new Map()
});

const chunks = <T>(rows: T[]): T[][] => {
  const parts: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) parts.push(rows.slice(i, i + CHUNK));
  return parts;
};

/**
 * Counts calls per arrow and minute in memory and writes them to Postgres
 * every few seconds. Memory stays bounded by capping distinct operations and
 * service pairs, so a misbehaving sender cannot grow the tables without limit.
 */
@Injectable()
export class TrafficAggregator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private buffers = new Map<string, ProjectBuffer>();
  private timer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();

  /** Distinct operations seen per (project, caller, callee) since the last reset. */
  private operations = new Map<string, Set<string>>();
  private pairs = new Map<string, Set<string>>();
  private warnedPairCap = new Set<string>();
  private capsResetAt = 0;

  /** When each service, alias and key was last queued for a write. */
  private lastWrite = new Map<string, number>();

  constructor(@Inject(DB) private readonly db: Database) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  add(key: IngestKeyRef, batch: TrafficBatch, now: number = Date.now()): void {
    this.resetCaps(now);
    const buffer = this.bufferFor(key.projectId);

    for (const event of batch.events) {
      const operation = this.admit(key.projectId, event);
      if (operation === null) continue;
      this.count(buffer, event, operation);
    }
    this.queueIdentity(key, buffer, batch, now);
  }

  /** Writes everything added so far. Flushes run one after another, never overlapping. */
  flush(now: number = Date.now()): Promise<void> {
    this.queue = this.queue.then(() => this.write(now));
    return this.queue;
  }

  private bufferFor(projectId: string): ProjectBuffer {
    let buffer = this.buffers.get(projectId);
    if (!buffer) {
      buffer = newBuffer();
      this.buffers.set(projectId, buffer);
    }
    return buffer;
  }

  private resetCaps(now: number): void {
    if (now < this.capsResetAt) return;
    this.operations.clear();
    this.pairs.clear();
    this.warnedPairCap.clear();
    this.capsResetAt = now + DAY_MS;
  }

  /** The operation name to count under, or null when the pair is over the cap. */
  private admit(projectId: string, event: TrafficEvent): string | null {
    const pair = `${event.caller}${SEP}${event.callee}`;
    let projectPairs = this.pairs.get(projectId);
    if (!projectPairs) {
      projectPairs = new Set();
      this.pairs.set(projectId, projectPairs);
    }
    if (!projectPairs.has(pair)) {
      if (projectPairs.size >= MAX_PAIRS_PER_PROJECT) {
        if (!this.warnedPairCap.has(projectId)) {
          this.warnedPairCap.add(projectId);
          logger.warn(`Project ${projectId} is over ${MAX_PAIRS_PER_PROJECT} service pairs; dropping new ones`);
        }
        return null;
      }
      projectPairs.add(pair);
    }

    const operationsKey = `${projectId}${SEP}${pair}`;
    let seen = this.operations.get(operationsKey);
    if (!seen) {
      seen = new Set();
      this.operations.set(operationsKey, seen);
    }
    if (seen.has(event.operation)) return event.operation;
    if (seen.size >= MAX_OPERATIONS_PER_PAIR) return OVERFLOW_OPERATION;
    seen.add(event.operation);
    return event.operation;
  }

  private count(buffer: ProjectBuffer, event: TrafficEvent, operation: string): void {
    const minute = Math.floor(event.at / MINUTE_MS) * MINUTE_MS;
    const id = [event.kind, event.caller, event.callee, operation, minute].join(SEP);
    let row = buffer.minutes.get(id);
    if (!row) {
      row = {
        kind: event.kind,
        caller: event.caller,
        callee: event.callee,
        operation,
        minute,
        calls: 0,
        failures: 0,
        durationSumMs: 0,
        histogram: emptyHistogram()
      };
      buffer.minutes.set(id, row);
    }
    row.calls += 1;
    row.durationSumMs += event.durationMs;
    const bucket = bucketOf(event.durationMs);
    row.histogram[bucket] = (row.histogram[bucket] ?? 0) + 1;
    if (!event.failed) return;
    row.failures += 1;

    const arrow = `${event.caller}${SEP}${event.callee}`;
    const buffered = buffer.failureCounts.get(arrow) ?? 0;
    if (buffered >= MAX_FAILURES_PER_ARROW) return;
    buffer.failureCounts.set(arrow, buffered + 1);
    buffer.failures.push({
      kind: event.kind,
      caller: event.caller,
      callee: event.callee,
      operation,
      at: event.at,
      durationMs: event.durationMs,
      status: event.status ?? ''
    });
  }

  /** Queues services, aliases and the key's last use, each at most once a minute. */
  private queueIdentity(key: IngestKeyRef, buffer: ProjectBuffer, batch: TrafficBatch, now: number): void {
    const due = (id: string): boolean => {
      const last = this.lastWrite.get(id);
      if (last !== undefined && now - last < MINUTE_MS) return false;
      this.lastWrite.set(id, now);
      return true;
    };

    for (const service of batch.services) {
      if (!due(`service${SEP}${key.id}${SEP}${service}`)) continue;
      const names = buffer.services.get(key.id) ?? new Set<string>();
      names.add(service);
      buffer.services.set(key.id, names);
    }
    for (const alias of batch.aliases) {
      const id = `${alias.host}${SEP}${alias.service}`;
      if (due(`alias${SEP}${key.projectId}${SEP}${id}`)) buffer.aliases.set(id, alias);
    }
    // An empty entry still marks the key as used.
    if (due(`key${SEP}${key.id}`) && !buffer.services.has(key.id)) buffer.services.set(key.id, new Set());
  }

  private async write(now: number): Promise<void> {
    const buffers = this.buffers;
    this.buffers = new Map();
    for (const [projectId, buffer] of buffers) {
      await this.guard(projectId, 'traffic_minute', () => this.writeMinutes(projectId, buffer));
      await this.guard(projectId, 'traffic_failure', () => this.writeFailures(projectId, buffer));
      await this.guard(projectId, 'traffic_alias', () => this.writeAliases(projectId, buffer, now));
      await this.guard(projectId, 'ingest_service', () => this.writeKeys(buffer, now));
    }
  }

  /** Runs one write; a failure is logged (never with span content) and that part dropped. */
  private async guard(projectId: string, table: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not write ${table} for project ${projectId}: ${reason}`);
    }
  }

  private async writeMinutes(projectId: string, buffer: ProjectBuffer): Promise<void> {
    const rows = [...buffer.minutes.values()].map((row) => ({
      ...row,
      projectId,
      minute: new Date(row.minute)
    }));
    for (const part of chunks(rows)) {
      await this.db
        .insert(trafficMinute)
        .values(part)
        .onConflictDoUpdate({
          target: [
            trafficMinute.projectId,
            trafficMinute.kind,
            trafficMinute.caller,
            trafficMinute.callee,
            trafficMinute.operation,
            trafficMinute.minute
          ],
          set: {
            calls: sql`${trafficMinute.calls} + excluded.calls`,
            failures: sql`${trafficMinute.failures} + excluded.failures`,
            durationSumMs: sql`${trafficMinute.durationSumMs} + excluded.duration_sum_ms`,
            histogram: sql`int_array_add(${trafficMinute.histogram}, excluded.histogram)`
          }
        });
    }
  }

  private async writeFailures(projectId: string, buffer: ProjectBuffer): Promise<void> {
    const rows = buffer.failures.map((row) => ({ ...row, projectId, at: new Date(row.at) }));
    for (const part of chunks(rows)) await this.db.insert(trafficFailure).values(part);
  }

  private async writeAliases(projectId: string, buffer: ProjectBuffer, now: number): Promise<void> {
    const rows = [...buffer.aliases.values()].map((alias) => ({ ...alias, projectId, lastSeenAt: new Date(now) }));
    for (const part of chunks(rows)) {
      await this.db
        .insert(trafficAlias)
        .values(part)
        .onConflictDoUpdate({
          target: [trafficAlias.projectId, trafficAlias.host, trafficAlias.service],
          set: { lastSeenAt: new Date(now) }
        });
    }
  }

  private async writeKeys(buffer: ProjectBuffer, now: number): Promise<void> {
    const lastSeenAt = new Date(now);
    for (const [keyId, names] of buffer.services) {
      const rows = [...names].map((serviceName) => ({ keyId, serviceName, lastSeenAt }));
      for (const part of chunks(rows)) {
        await this.db
          .insert(ingestService)
          .values(part)
          .onConflictDoUpdate({ target: [ingestService.keyId, ingestService.serviceName], set: { lastSeenAt } });
      }
      await this.db.update(ingestKey).set({ lastUsedAt: lastSeenAt }).where(eq(ingestKey.id, keyId));
    }
  }
}
