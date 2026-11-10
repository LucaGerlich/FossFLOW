import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { parseBody } from '../common/validation.js';
import { DB, type Database } from '../database/database.module.js';
import { user } from '../database/schema.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { canGrantInstanceRole, canManageUser, INSTANCE_ROLES } from '../rbac/roles.js';
import { RequireScopes } from '../rbac/scopes.guard.js';
import { AccountsService } from './accounts.service.js';
import { ROLE_CHANGED, UsersService } from './users.service.js';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  instanceRole: string;
  createdAt: Date;
}

const summary = {
  id: user.id,
  name: user.name,
  email: user.email,
  instanceRole: user.instanceRole,
  createdAt: user.createdAt
};

const roleSchema = z.object({ instanceRole: z.enum(INSTANCE_ROLES, 'Choose a valid role') });

@Controller('users')
export class UsersController {
  private readonly logger = new Logger('Users');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accounts: AccountsService,
    private readonly users: UsersService,
    private readonly sources: LiveSourcesService
  ) {}

  @Get()
  @RequireScopes('user:list')
  list(): Promise<UserSummary[]> {
    return this.db.select(summary).from(user).orderBy(asc(user.createdAt));
  }

  /** For handing over when there's no mail server. Owners reset anyone; admins reset members. */
  @Post(':id/password-reset-link')
  @RequireScopes('user:resetPassword')
  async passwordResetLink(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string
  ): Promise<{ url: string }> {
    const target = await this.manageable(session, id, 'You can’t reset this person’s password');
    return { url: await this.accounts.createPasswordResetLink(target.id) };
  }

  /** Takes effect on the person's next request: sessions read the role from the database. */
  @Patch(':id')
  @RequireScopes('user:changeRole')
  async changeRole(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string,
    @Body() raw: unknown
  ): Promise<{ ok: true }> {
    const { instanceRole } = parseBody(roleSchema, raw);
    const target = await this.manageable(session, id, 'You can’t change this person’s role');
    if (!canGrantInstanceRole(session.user.instanceRole, instanceRole)) {
      throw new ForbiddenException({ error: 'You can’t give that role' });
    }
    // Only if the role is still the one the rules were checked against.
    const changed = await this.db
      .update(user)
      .set({ instanceRole, updatedAt: new Date() })
      .where(and(eq(user.id, target.id), eq(user.instanceRole, target.instanceRole)))
      .returning({ id: user.id });
    if (changed.length === 0) throw new ConflictException({ error: ROLE_CHANGED });
    this.logger.log(`${session.user.id} changed the role of ${target.id} to ${instanceRole}`);
    return { ok: true };
  }

  /** Their personal landscapes and credentials move to `transferTo`, or are deleted with them. */
  @Delete(':id')
  @RequireScopes('user:delete')
  @HttpCode(204)
  async remove(
    @CurrentSession() session: AuthSession,
    @Param('id') id: string,
    @Query('transferTo') transferTo?: string
  ): Promise<void> {
    const target = await this.manageable(session, id, 'You can’t delete this person');
    if (transferTo) {
      if (transferTo === target.id) {
        throw new BadRequestException({ error: 'Choose someone else to take over their work' });
      }
      const [heir] = await this.db.select({ id: user.id }).from(user).where(eq(user.id, transferTo));
      if (!heir) throw new NotFoundException({ error: 'User not found' });
    }
    await this.users.remove(target.id, target.instanceRole, transferTo || undefined);
    this.logger.log(
      `${session.user.id} deleted user ${target.id}; their personal work ${transferTo ? `moved to ${transferTo}` : 'was deleted'}`
    );
    // Credentials deleted with them must stop polling.
    await this.sources.refresh();
  }

  /** Someone else, whom the signed-in person outranks (the owner can never be a target). */
  private async manageable(session: AuthSession, id: string, refusal: string): Promise<UserSummary> {
    const [target] = await this.db.select(summary).from(user).where(eq(user.id, id));
    if (!target) throw new NotFoundException({ error: 'User not found' });
    if (target.id === session.user.id) {
      throw new BadRequestException({ error: 'You can’t do this to your own account' });
    }
    if (!canManageUser(session.user.instanceRole, target.instanceRole)) {
      throw new ForbiddenException({ error: refusal });
    }
    return target;
  }
}
