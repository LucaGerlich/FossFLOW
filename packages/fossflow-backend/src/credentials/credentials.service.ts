import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { MASTER_KEY } from '../auth/auth.module.js';
import type { AlertMessage } from '../connectors/channels/message.js';
import {
  type ChannelConnector,
  type Connector,
  type ConnectorKind,
  publicSettings,
  type SourceConnector
} from '../connectors/connector.js';
import { POST_JSON, type postJson } from '../connectors/outbound.js';
import { findConnector } from '../connectors/registry.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { type Cipher, createCipher } from '../crypto/cipher.js';
import { DB, type Database } from '../database/database.module.js';
import { alertRule, credential, landscapeSource, project } from '../database/schema.js';
import { LiveSourceError } from '../live/source-error.js';
import { MAILER, type Mailer } from '../mail/mailer.js';

export interface CredentialSummary {
  id: string;
  name: string;
  type: string;
  /** Whether this feeds live data or receives alerts. */
  kind: ConnectorKind;
  updatedAt: Date;
  /** How many landscapes show this credential's live data. */
  usedBy: number;
}

export interface CredentialDetail {
  id: string;
  projectId: string;
  name: string;
  type: string;
  /** Non-secret settings only. */
  settings: Record<string, unknown>;
  /** Which secret fields have a stored value (the values never leave the server). */
  secretsSet: string[];
  updatedAt: Date;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

const TEST_HISTORY = { cpu: [], memory: [], disk: [] };
/** A connection test answers within this, however many requests it needs. */
export const TEST_DEADLINE_MS = Symbol('TEST_DEADLINE_MS');
export const DEFAULT_TEST_DEADLINE_MS = 15_000;

@Injectable()
export class CredentialsService {
  private readonly cipher: Cipher;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(MASTER_KEY) masterKey: Buffer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(POST_JSON) private readonly post: typeof postJson,
    @Inject(TEST_DEADLINE_MS) private readonly deadlineMs: number
  ) {
    this.cipher = createCipher(masterKey);
  }

  async list(projectId: string): Promise<CredentialSummary[]> {
    const rows = await this.db
      .select({
        id: credential.id,
        name: credential.name,
        type: credential.type,
        updatedAt: credential.updatedAt,
        usedBy: count(landscapeSource.landscapeId)
      })
      .from(credential)
      .leftJoin(landscapeSource, eq(landscapeSource.credentialId, credential.id))
      .where(eq(credential.projectId, projectId))
      .groupBy(credential.id)
      .orderBy(asc(credential.name));
    return rows.map((row) => ({ ...row, kind: findConnector(row.type)?.kind ?? 'source' }));
  }

  async get(id: string): Promise<CredentialDetail> {
    const row = await this.row(id);
    const connector = this.connector(row.type);
    const settings = this.cipher.decrypt(row.data) as Record<string, unknown>;
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      type: row.type,
      ...publicSettings(connector, settings),
      updatedAt: row.updatedAt
    };
  }

  async create(
    projectId: string,
    authorId: string,
    input: { name: string; type: string; settings: unknown }
  ): Promise<{ id: string; test: TestResult }> {
    const { connector, settings, data } = this.seal(input.type, input.settings);
    if (connector.id === 'email' && !this.mailer.enabled) {
      throw new BadRequestException({ error: 'Email needs SMTP to be configured' });
    }
    const id = randomUUID();
    await this.db.insert(credential).values({
      id,
      projectId,
      name: input.name,
      type: connector.id,
      data,
      createdBy: authorId,
      updatedBy: authorId
    });
    return { id, test: await this.testSettings(connector, settings, projectId) };
  }

  /** Validates settings for a connector and encrypts them for the `data` column. */
  seal(type: string, input: unknown): { connector: Connector; settings: Record<string, unknown>; data: string } {
    const connector = this.connector(type);
    const settings = this.validate(connector, input);
    return { connector, settings, data: this.cipher.encrypt(settings) };
  }

  /**
   * Updates name and settings. Secret fields left empty keep their stored
   * value, so nobody has to re-enter a password to rename a credential. But
   * when a connection field (URL, email, …) changes, every secret must be
   * entered again: otherwise anyone who can edit could point the stored
   * password at their own server and read it there.
   */
  async update(
    id: string,
    authorId: string,
    input: { name?: string | undefined; settings?: Record<string, unknown> | undefined }
  ): Promise<{ test: TestResult }> {
    const row = await this.row(id);
    const connector = this.connector(row.type);
    const stored = this.cipher.decrypt(row.data) as Record<string, unknown>;
    const merged = { ...stored };
    const kept: string[] = [];
    for (const field of connector.fields) {
      const value = input.settings?.[field.name];
      if (field.secret && (value === undefined || value === '')) kept.push(field.label);
      else if (value !== undefined) merged[field.name] = value;
    }
    const settings = this.validate(connector, merged);
    const moved = connector.fields.filter(
      (field) => !field.secret && settings[field.name] !== stored[field.name]
    );
    if (moved.length > 0 && kept.length > 0) {
      throw new BadRequestException({
        error: `Enter the ${kept.join(' and ').toLowerCase()} again when you change the ${moved
          .map((field) => field.label)
          .join(' or ')}`
      });
    }
    await this.db
      .update(credential)
      .set({
        name: input.name ?? row.name,
        data: this.cipher.encrypt(settings),
        updatedBy: authorId,
        updatedAt: new Date()
      })
      .where(eq(credential.id, id));
    return { test: await this.testSettings(connector, settings, row.projectId) };
  }

  /** Deleting a channel also takes it off the alert rules of its project, so they stay editable. */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select({ projectId: credential.projectId }).from(credential).where(eq(credential.id, id));
      if (row) {
        await tx
          .update(alertRule)
          .set({ channelIds: sql`array_remove(${alertRule.channelIds}, ${id})` })
          .where(and(eq(alertRule.projectId, row.projectId), sql`${id} = any(${alertRule.channelIds})`));
      }
      await tx.delete(credential).where(eq(credential.id, id));
    });
  }

  async test(id: string): Promise<TestResult> {
    const row = await this.row(id);
    const connector = this.connector(row.type);
    return this.testSettings(connector, this.cipher.decrypt(row.data), row.projectId);
  }

  /** Decrypted settings, for the live source manager only. */
  async settingsFor(
    id: string
  ): Promise<{ connector: Connector; settings: unknown; name: string; projectId: string }> {
    const row = await this.row(id);
    return {
      connector: this.connector(row.type),
      settings: this.cipher.decrypt(row.data),
      name: row.name,
      projectId: row.projectId
    };
  }

  /** One real read or send, so a typo shows up right away. */
  private testSettings(connector: Connector, settings: unknown, projectId: string): Promise<TestResult> {
    return connector.kind === 'channel'
      ? this.testChannel(connector, settings, projectId)
      : this.testSource(connector, settings);
  }

  /** Sends a test message; delivery problems come back as a result, never an error. */
  private async testChannel(
    connector: ChannelConnector,
    settings: unknown,
    projectId: string
  ): Promise<TestResult> {
    const [row] = await this.db.select({ name: project.name }).from(project).where(eq(project.id, projectId));
    const name = row?.name ?? '';
    const message: AlertMessage = {
      state: 'test',
      kind: null,
      ruleId: null,
      ruleName: name,
      projectName: name,
      target: null,
      value: null,
      threshold: null,
      windowMinutes: null,
      calls: null,
      sinceMinutes: null,
      startedAt: null,
      durationMinutes: null,
      url: `${this.config.publicUrl}/projects/${projectId}/monitoring`
    };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<TestResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, message: 'Not delivered (timeout)' }), this.deadlineMs);
    });
    try {
      // ponytail: a send that misses the deadline still runs out its own timeouts in the background.
      const sending = connector.send(settings, message, { postJson: this.post, mailer: this.mailer });
      const result = await Promise.race([sending, deadline]);
      if ('message' in result) return result;
      if (result.ok) return { ok: true, message: 'Test message sent' };
      return { ok: false, message: `Not delivered (${result.status ?? result.error ?? 'network'})` };
    } catch (error) {
      // Settings that no longer validate count as missing; anything else as a network problem.
      return { ok: false, message: `Not delivered (${error instanceof ZodError ? 'missing' : 'network'})` };
    } finally {
      clearTimeout(timer);
    }
  }

  /** One real read through the connector. */
  private async testSource(connector: SourceConnector, settings: unknown): Promise<TestResult> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LiveSourceError('No answer within 15 seconds')), this.deadlineMs);
    });
    try {
      // ponytail: the requests behind a missed deadline still run out their own 10 s timeouts.
      const result = await Promise.race([
        connector.open(settings).fetch({
          sourceId: 'test',
          historyFor: () => TEST_HISTORY,
          nowMs: Date.now()
        }),
        deadline
      ]);
      const count = result.systems.length;
      return { ok: true, message: `Connected: ${count} ${count === 1 ? 'server' : 'servers'} visible` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof LiveSourceError ? error.message : 'Could not connect'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private validate(connector: Connector, settings: unknown): Record<string, unknown> {
    try {
      return connector.validate(settings);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          error: error.issues[0]?.message ?? 'Invalid settings',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        });
      }
      throw error;
    }
  }

  private connector(type: string): Connector {
    const connector = findConnector(type);
    if (!connector) throw new BadRequestException({ error: `Unknown connector "${type}"` });
    return connector;
  }

  private async row(id: string) {
    const [row] = await this.db.select().from(credential).where(eq(credential.id, id));
    if (!row) throw new NotFoundException({ error: 'Credential not found' });
    return row;
  }
}
