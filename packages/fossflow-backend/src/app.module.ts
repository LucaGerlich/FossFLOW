import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { OriginGuard, SessionGuard } from './auth/guards.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsService } from './invitations/invitations.service.js';
import { LiveModule } from './live/live.module.js';
import { ScopesGuard } from './rbac/scopes.guard.js';
import { SetupController } from './setup/setup.controller.js';
import { SetupService } from './setup/setup.service.js';
import { UsersController } from './users/users.controller.js';

/** Per client IP; nginx forwards the real IP and the app trusts loopback only. */
const RATE_LIMIT = { ttl: 60_000, limit: 120 };

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        ThrottlerModule.forRoot({ throttlers: [RATE_LIMIT] }),
        DatabaseModule,
        AuthModule,
        LiveModule
      ],
      controllers: [HealthController, SetupController, InvitationsController, UsersController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        SetupService,
        InvitationsService,
        // Guards run in this order: rate limit, CSRF origin, session, role scopes.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: ScopesGuard }
      ],
      exports: [APP_CONFIG]
    };
  }
}
