import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { TEAM_PROJECT_ROLES } from '../rbac/roles.js';
import { RequireScopes } from '../rbac/scopes.guard.js';
import { CurrentProject, type ProjectAccessInfo, RequireProjectScope } from './project-access.js';
import { ProjectsService } from './projects.service.js';

const nameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long')
});
const memberSchema = z.object({ role: z.enum(TEAM_PROJECT_ROLES) });

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentSession() session: AuthSession) {
    return this.projects.listVisible(session.user);
  }

  @Post()
  @RequireScopes('project:create')
  create(@CurrentSession() session: AuthSession, @Body() raw: unknown) {
    return this.projects.createTeam(session.user.id, parseBody(nameSchema, raw).name);
  }

  @Get(':id')
  @RequireProjectScope('project:read')
  async get(@CurrentProject() access: ProjectAccessInfo, @Param('id') id: string) {
    const members = await this.projects.members(id);
    return {
      id,
      name: access.name,
      type: access.type,
      role: access.role,
      scopes: [...access.scopes],
      members
    };
  }

  @Patch(':id')
  @RequireProjectScope('project:update')
  async rename(@Param('id') id: string, @Body() raw: unknown): Promise<{ ok: true }> {
    await this.projects.rename(id, parseBody(nameSchema, raw).name);
    return { ok: true };
  }

  @Delete(':id')
  @RequireProjectScope('project:delete')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.projects.remove(id);
  }

  @Get(':id/candidates')
  @RequireProjectScope('projectMember:manage')
  candidates(@Param('id') id: string) {
    return this.projects.candidates(id);
  }

  @Put(':id/members/:userId')
  @RequireProjectScope('projectMember:manage')
  async setMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() raw: unknown
  ): Promise<{ ok: true }> {
    await this.projects.setMember(id, userId, parseBody(memberSchema, raw).role);
    return { ok: true };
  }

  @Delete(':id/members/:userId')
  @RequireProjectScope('projectMember:manage')
  @HttpCode(204)
  async removeMember(@Param('id') id: string, @Param('userId') userId: string): Promise<void> {
    await this.projects.removeMember(id, userId);
  }
}
