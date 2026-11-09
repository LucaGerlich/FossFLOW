import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthSession } from '../auth/auth.js';
import { CurrentSession, Public } from '../auth/guards.js';
import { passwordSchema } from '../auth/password-policy.js';
import { parseBody } from '../common/validation.js';
import { RequireScopes } from '../rbac/scopes.guard.js';
import { AccountsService } from '../users/accounts.service.js';
import { InvitationsService, type PendingInvitation } from './invitations.service.js';

const createSchema = z.object({
  email: z.email('Enter a valid email address').max(254),
  instanceRole: z.enum(['global:admin', 'global:member'])
});

const acceptSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  password: passwordSchema
});

/** 256-bit tokens in base64url; anything else is rejected before a lookup. */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly accounts: AccountsService
  ) {}

  @Get()
  @RequireScopes('user:invite')
  list(): Promise<PendingInvitation[]> {
    return this.invitations.listPending();
  }

  @Post()
  @RequireScopes('user:invite')
  create(@CurrentSession() session: AuthSession, @Body() raw: unknown) {
    return this.invitations.create(session.user, parseBody(createSchema, raw));
  }

  @Delete(':id')
  @RequireScopes('user:invite')
  @HttpCode(204)
  async revoke(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.invitations.revoke(id);
  }

  @Get('accept/:token')
  @Public()
  lookup(@Param('token') token: string) {
    return this.invitations.lookup(parseBody(tokenSchema, token));
  }

  @Post('accept/:token')
  @Public()
  @HttpCode(201)
  async accept(
    @Param('token') token: string,
    @Body() raw: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ ok: true }> {
    const body = parseBody(acceptSchema, raw);
    const { email } = await this.invitations.accept(parseBody(tokenSchema, token), body);
    response.setHeader(
      'Set-Cookie',
      await this.accounts.signIn(email, body.password, fromNodeHeaders(request.headers))
    );
    return { ok: true };
  }
}
