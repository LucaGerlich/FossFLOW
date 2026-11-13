import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { RequireProjectScope } from '../projects/project-access.js';
import { IngestKeysService } from './ingest-keys.service.js';

/** The name goes into OTEL_SERVICE_NAME unquoted, so it stays shell- and env-safe. */
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, 'Use letters, digits, dots, dashes and underscores (up to 100)')
});

@Controller()
export class IngestKeysController {
  constructor(private readonly keys: IngestKeysService) {}

  @Get('projects/:id/ingest-keys')
  @RequireProjectScope('ingestKey:read')
  list(@Param('id') projectId: string) {
    return this.keys.list(projectId);
  }

  @Post('projects/:id/ingest-keys')
  @RequireProjectScope('ingestKey:create')
  @Header('Cache-Control', 'no-store')
  create(@CurrentSession() session: AuthSession, @Param('id') projectId: string, @Body() raw: unknown) {
    return this.keys.create(projectId, session.user.id, parseBody(createSchema, raw).name);
  }

  @Delete('ingest-keys/:id')
  @RequireProjectScope('ingestKey:delete', { target: 'ingestKey' })
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.keys.remove(id);
  }
}
