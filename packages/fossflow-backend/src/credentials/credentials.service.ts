import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { MASTER_KEY } from '../auth/auth.module.js';
import { type Connector, publicSettings } from '../connectors/connector.js';
import { findConnector } from '../connectors/registry.js';
import { type Cipher, createCipher } from '../crypto/cipher.js';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscapeSource } from '../database/schema.js';
import { LiveSourceError } from '../live/source-error.js';

export interface CredentialSummary {
  id: string;
  name: string;
  type: string;
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
const TEST_DEADLINE_MS = 15_000;

@Injectable()
export class CredentialsService {
  private readonly cipher: Cipher;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(MASTER_KEY) masterKey: Buffer
  ) {
    this.cipher = createCipher(masterKey);
  }

  list(projectId: string): Promise<CredentialSummary[]> {
    return this.db
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
    return { id, test: await this.testSettings(connector, settings) };
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
    return { test: await this.testSettings(connector, settings) };
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(credential).where(eq(credential.id, id));
  }

  async test(id: string): Promise<TestResult> {
    const row = await this.row(id);
    const connector = this.connector(row.type);
    return this.testSettings(connector, this.cipher.decrypt(row.data));
  }

  /** Decrypted settings, for the live source manager only. */
  async settingsFor(id: string): Promise<{ connector: Connector; settings: unknown; name: string }> {
    const row = await this.row(id);
    return {
      connector: this.connector(row.type),
      settings: this.cipher.decrypt(row.data),
      name: row.name
    };
  }

  /** One real read through the connector, so a typo shows up right away. */
  private async testSettings(connector: Connector, settings: unknown): Promise<TestResult> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LiveSourceError('No answer within 15 seconds')), TEST_DEADLINE_MS);
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
