import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AUTH, type Auth, resetPasswordPage } from '../auth/auth.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { InstanceRole } from '../rbac/roles.js';

const RESET_LINK_TTL_MS = 60 * 60 * 1000;

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

/**
 * Account operations that better-auth's public API doesn't offer while
 * sign-up is disabled. They use the same internals as its own routes
 * (sign-up and password reset); integration tests cover each flow end to
 * end, so an upgrade that changes them fails loudly.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    instanceRole: InstanceRole;
  }): Promise<{ id: string }> {
    const context = await this.auth.$context;
    const email = input.email.trim().toLowerCase();
    if (await context.internalAdapter.findUserByEmail(email)) {
      throw new ConflictException({ error: 'An account with this email already exists' });
    }

    const hash = await context.password.hash(input.password);
    let user: { id: string };
    try {
      user = await context.internalAdapter.createUser(
        {
          email,
          name: input.name.trim(),
          emailVerified: false,
          instanceRole: input.instanceRole
        },
        { method: 'email-password' }
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ error: 'An account with this email already exists' });
      }
      throw error;
    }

    try {
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: hash
      });
    } catch (error) {
      // Never leave an account without a password behind.
      await context.internalAdapter.deleteUser(user.id);
      throw error;
    }
    return { id: user.id };
  }

  /** Signs in and returns the session cookies to pass on to the browser. */
  async signIn(email: string, password: string, headers: Headers): Promise<string[]> {
    const result = await this.auth.api.signInEmail({
      body: { email: email.trim().toLowerCase(), password },
      headers,
      returnHeaders: true
    });
    return result.headers.getSetCookie();
  }

  /** A one-hour reset link, for admins to hand over when there's no mail server. */
  async createPasswordResetLink(userId: string): Promise<string> {
    const context = await this.auth.$context;
    const token = randomBytes(24).toString('base64url');
    await context.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS)
    });
    return `${resetPasswordPage(this.config)}?token=${token}`;
  }
}
