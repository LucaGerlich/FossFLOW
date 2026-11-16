import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { RequireProjectScope } from '../projects/project-access.js';
import { ruleInputSchema, rulePatchSchema } from './rule-input.js';
import { RulesService } from './rules.service.js';

const eventsQuerySchema = z.object({
  state: z.enum(['active', 'resolved']).default('active'),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1, 'Limit is at least 1').max(50, 'Limit is at most 50').default(20)
});

const onRule = { target: 'alertRule' as const };

@Controller()
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get('projects/:id/alert-rules')
  @RequireProjectScope('project:read')
  list(@Param('id') projectId: string) {
    return this.rules.list(projectId);
  }

  @Post('projects/:id/alert-rules')
  @RequireProjectScope('alertRule:create')
  create(@CurrentSession() session: AuthSession, @Param('id') projectId: string, @Body() raw: unknown) {
    return this.rules.create(projectId, session.user.id, parseBody(ruleInputSchema, raw));
  }

  @Patch('alert-rules/:id')
  @RequireProjectScope('alertRule:update', onRule)
  update(@Param('id') id: string, @Body() raw: unknown) {
    return this.rules.update(id, parseBody(rulePatchSchema, raw));
  }

  @Delete('alert-rules/:id')
  @RequireProjectScope('alertRule:delete', onRule)
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.rules.remove(id);
  }

  @Get('projects/:id/alerts')
  @RequireProjectScope('project:read')
  events(@Param('id') projectId: string, @Query() raw: unknown) {
    return this.rules.events(projectId, parseBody(eventsQuerySchema, raw));
  }
}
