import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/guards.js';
import { passwordSchema } from '../auth/password-policy.js';
import { parseBody, personName } from '../common/validation.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { AccountsService } from '../users/accounts.service.js';
import { SetupService } from './setup.service.js';

export const accountSchema = z.object({
  name: personName,
  email: z.email('Enter a valid email address').max(254),
  password: passwordSchema
});

@Controller()
@Public()
export class SetupController {
  constructor(
    private readonly setup: SetupService,
    private readonly accounts: AccountsService,
    @Inject(MAILER) private readonly mailer: Mailer
  ) {}

  /** Lets the app choose between platform mode (with first-run setup) and local mode. */
  @Get('platform/status')
  async status(): Promise<{ platform: true; setupRequired: boolean; mailEnabled: boolean }> {
    return {
      platform: true,
      setupRequired: await this.setup.isSetupRequired(),
      mailEnabled: this.mailer.enabled
    };
  }

  @Post('setup/owner')
  @HttpCode(201)
  async createOwner(
    @Body() raw: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<{ ok: true }> {
    const body = parseBody(accountSchema, raw);
    await this.setup.createOwner(body);
    const cookies = await this.accounts.signIn(
      body.email,
      body.password,
      fromNodeHeaders(request.headers)
    );
    response.setHeader('Set-Cookie', cookies);
    return { ok: true };
  }
}
