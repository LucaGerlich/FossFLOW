import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession } from '../auth/guards.js';
import { DB, type Database } from '../database/database.module.js';
import { user } from '../database/schema.js';
import { canManageUser } from '../rbac/roles.js';
import { RequireScopes } from '../rbac/scopes.guard.js';
import { AccountsService } from './accounts.service.js';

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

@Controller('users')
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accounts: AccountsService
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
    const [target] = await this.db.select(summary).from(user).where(eq(user.id, id));
    if (!target) throw new NotFoundException({ error: 'User not found' });
    if (!canManageUser(session.user.instanceRole, target.instanceRole)) {
      throw new ForbiddenException({ error: 'You can’t reset this person’s password' });
    }
    return { url: await this.accounts.createPasswordResetLink(target.id) };
  }
}
