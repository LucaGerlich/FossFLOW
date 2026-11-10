import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { connectorInfos } from '../connectors/registry.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { RequireProjectScope } from '../projects/project-access.js';
import { CredentialsService } from './credentials.service.js';

const nameField = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
const settingsField = z.record(z.string(), z.unknown());

const createSchema = z.object({ name: nameField, type: z.string().min(1), settings: settingsField });
const updateSchema = z.object({ name: nameField.optional(), settings: settingsField.optional() });

const onCredential = { target: 'credential' as const };
/** Create, update and test each contact another server; 20 a minute per client is plenty. */
const OUTBOUND_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@Controller()
export class CredentialsController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly sources: LiveSourcesService
  ) {}

  /** The kinds of live sources and their credential forms. */
  @Get('connectors')
  connectors() {
    return connectorInfos();
  }

  @Get('projects/:id/credentials')
  @RequireProjectScope('credential:read')
  list(@Param('id') projectId: string) {
    return this.credentials.list(projectId);
  }

  @Post('projects/:id/credentials')
  @RequireProjectScope('credential:create')
  @Throttle(OUTBOUND_LIMIT)
  create(
    @CurrentSession() session: AuthSession,
    @Param('id') projectId: string,
    @Body() raw: unknown
  ) {
    return this.credentials.create(projectId, session.user.id, parseBody(createSchema, raw));
  }

  /** The edit form's values; viewers only see names in the list. */
  @Get('credentials/:id')
  @RequireProjectScope('credential:update', onCredential)
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.credentials.get(id);
  }

  @Patch('credentials/:id')
  @RequireProjectScope('credential:update', onCredential)
  @Throttle(OUTBOUND_LIMIT)
  async update(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string,
    @Body() raw: unknown
  ) {
    const result = await this.credentials.update(id, session.user.id, parseBody(updateSchema, raw));
    await this.sources.refresh();
    return result;
  }

  @Delete('credentials/:id')
  @RequireProjectScope('credential:delete', onCredential)
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.credentials.remove(id);
    await this.sources.refresh();
  }

  @Post('credentials/:id/test')
  @RequireProjectScope('credential:use', onCredential)
  @Throttle(OUTBOUND_LIMIT)
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.credentials.test(id);
  }
}
