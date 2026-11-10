import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { CurrentProject, type ProjectAccessInfo, RequireProjectScope } from '../projects/project-access.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { LandscapesService } from './landscapes.service.js';
import { landscapeModelSchema } from './model.js';

const nameField = z.string().trim().min(1, 'Name is required').max(200, 'Name is too long');

const createSchema = z.object({ name: nameField, model: landscapeModelSchema.optional() });
const saveSchema = z.object({
  model: landscapeModelSchema,
  /** The version this save is based on. */
  version: z.number().int().min(1)
});
const renameSchema = z.object({ name: nameField });
const moveSchema = z.object({ projectId: z.string().min(1) });

const onLandscape = { target: 'landscape' as const };

@Controller()
export class LandscapesController {
  constructor(
    private readonly landscapes: LandscapesService,
    private readonly sources: LiveSourcesService
  ) {}

  @Get('landscapes')
  overview(@CurrentSession() session: AuthSession) {
    return this.landscapes.listVisible(session.user);
  }

  @Get('projects/:id/landscapes')
  @RequireProjectScope('landscape:read')
  listInProject(@Param('id') projectId: string) {
    return this.landscapes.listInProject(projectId);
  }

  /** New, or imported when `model` is given. */
  @Post('projects/:id/landscapes')
  @RequireProjectScope('landscape:create')
  create(
    @CurrentSession() session: AuthSession,
    @Param('id') projectId: string,
    @Body() raw: unknown
  ) {
    return this.landscapes.create(projectId, session.user.id, parseBody(createSchema, raw));
  }

  @Get('landscapes/:id')
  @RequireProjectScope('landscape:read', onLandscape)
  async get(@CurrentProject() access: ProjectAccessInfo, @Param('id') id: string) {
    return { ...(await this.landscapes.get(id)), scopes: [...access.scopes] };
  }

  @Put('landscapes/:id')
  @RequireProjectScope('landscape:update', onLandscape)
  save(@CurrentSession() session: AuthSession, @Param('id') id: string, @Body() raw: unknown) {
    const body = parseBody(saveSchema, raw);
    return this.landscapes.save(id, session.user.id, {
      model: body.model,
      baseVersion: body.version
    });
  }

  @Patch('landscapes/:id')
  @RequireProjectScope('landscape:update', onLandscape)
  async rename(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string,
    @Body() raw: unknown
  ): Promise<{ ok: true }> {
    await this.landscapes.rename(id, session.user.id, parseBody(renameSchema, raw).name);
    return { ok: true };
  }

  @Delete('landscapes/:id')
  @RequireProjectScope('landscape:delete', onLandscape)
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.landscapes.remove(id);
    await this.sources.refresh();
  }

  @Post('landscapes/:id/move')
  @RequireProjectScope('landscape:move', onLandscape)
  @HttpCode(200)
  async move(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string,
    @Body() raw: unknown
  ): Promise<{ ok: true }> {
    await this.landscapes.move(id, session.user, parseBody(moveSchema, raw).projectId);
    await this.sources.refresh();
    return { ok: true };
  }
}
