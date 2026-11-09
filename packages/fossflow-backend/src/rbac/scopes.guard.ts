import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../auth/guards.js';
import { hasInstanceScope, type InstanceScope } from './roles.js';

const SCOPES_KEY = 'fossflow:scopes';

/** The signed-in user's role must grant every listed scope. */
export const RequireScopes = (...scopes: InstanceScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);

@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scopes = this.reflector.getAllAndOverride<InstanceScope[] | undefined>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!scopes?.length) return true;

    const role = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user
      .instanceRole;
    if (!role || !scopes.every((scope) => hasInstanceScope(role, scope))) {
      throw new ForbiddenException({ error: 'Not allowed for your role' });
    }
    return true;
  }
}
