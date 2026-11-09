import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AUTH, type Auth, type AuthSession } from './auth.js';

export interface AuthenticatedRequest extends Request {
  auth?: AuthSession;
}

const PUBLIC_KEY = 'fossflow:public';

/** Reachable without a session (health, setup, accepting an invitation). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** The signed-in user's session; only on routes behind the SessionGuard. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession => {
    const session = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!session) throw new UnauthorizedException();
    return session;
  }
);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated writes: a state-changing request
 * must come from FossFLOW's own origin. better-auth checks its own routes.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly origin: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.origin = new URL(config.publicUrl).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    const source = request.headers.origin ?? originOf(request.headers.referer);
    if (source !== this.origin) {
      throw new ForbiddenException({ error: 'Cross-origin request refused' });
    }
    return true;
  }
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Every route needs a session unless it is marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers)
    });
    if (!session) throw new UnauthorizedException({ error: 'Sign in required' });
    request.auth = session;
    return true;
  }
}
