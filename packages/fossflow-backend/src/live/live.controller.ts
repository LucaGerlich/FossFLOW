import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Put
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { parseBody } from '../common/validation.js';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscape, landscapeSource } from '../database/schema.js';
import { CurrentProject, type ProjectAccessInfo, RequireProjectScope } from '../projects/project-access.js';
import { LiveSourcesService } from './live-sources.service.js';
import type { LiveSnapshot } from './types.js';

const onLandscape = { target: 'landscape' as const };
const sourcesSchema = z.object({ credentialIds: z.array(z.string().min(1)).max(20) });

/** Which live sources a landscape shows, and their combined data. */
@Controller('landscapes/:id')
export class LiveController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sources: LiveSourcesService
  ) {}

  @Get('sources')
  @RequireProjectScope('landscape:read', onLandscape)
  list(@Param('id') landscapeId: string) {
    return this.db
      .select({ id: credential.id, name: credential.name, type: credential.type })
      .from(landscapeSource)
      .innerJoin(credential, eq(credential.id, landscapeSource.credentialId))
      .where(eq(landscapeSource.landscapeId, landscapeId));
  }

  /** Replaces the landscape's sources; they must be credentials of its own project. */
  @Put('sources')
  @RequireProjectScope('landscape:update', onLandscape)
  async set(
    @CurrentProject() access: ProjectAccessInfo,
    @Param('id') landscapeId: string,
    @Body() raw: unknown
  ): Promise<{ ok: true }> {
    if (!access.scopes.has('credential:use')) {
      throw new ForbiddenException({ error: 'You can’t use credentials in this project' });
    }
    const ids = [...new Set(parseBody(sourcesSchema, raw).credentialIds)];
    await this.db.transaction(async (tx) => {
      // Locks the landscape, so a move can't slip in between check and write.
      const [current] = await tx
        .select({ projectId: landscape.projectId })
        .from(landscape)
        .where(eq(landscape.id, landscapeId))
        .for('update');
      if (current?.projectId !== access.projectId) {
        throw new ConflictException({ error: 'This landscape just moved. Reload and try again.' });
      }
      if (ids.length > 0) {
        const found = await tx
          .select({ id: credential.id })
          .from(credential)
          .where(and(inArray(credential.id, ids), eq(credential.projectId, access.projectId)));
        if (found.length !== ids.length) {
          throw new BadRequestException({ error: 'Use credentials from this landscape’s project' });
        }
      }
      await tx.delete(landscapeSource).where(eq(landscapeSource.landscapeId, landscapeId));
      if (ids.length > 0) {
        await tx.insert(landscapeSource).values(ids.map((credentialId) => ({ landscapeId, credentialId })));
      }
    });
    await this.sources.refresh();
    return { ok: true };
  }

  @Get('live')
  @RequireProjectScope('landscape:read', onLandscape)
  @Header('Cache-Control', 'no-store')
  live(@Param('id') landscapeId: string): Promise<LiveSnapshot> {
    return this.sources.snapshotFor(landscapeId);
  }
}
