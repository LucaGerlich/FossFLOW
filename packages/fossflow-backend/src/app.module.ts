import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { OriginGuard, SessionGuard } from './auth/guards.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { CredentialsModule } from './credentials/credentials.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { IngestModule } from './ingest/ingest.module.js';
import { InvitationsController } from './invitations/invitations.controller.js';
import { InvitationsService } from './invitations/invitations.service.js';
import { LandscapesModule } from './landscapes/landscapes.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ScopesGuard } from './rbac/scopes.guard.js';
import { SetupController } from './setup/setup.controller.js';
import { SetupService } from './setup/setup.service.js';
import { StartupMigrations } from './setup/startup-migrations.js';
import { TrafficModule } from './traffic/traffic.module.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

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
        ProjectsModule,
        LandscapesModule,
        AuthModule,
        CredentialsModule,
        IngestModule,
        TrafficModule
      ],
      controllers: [HealthController, SetupController, InvitationsController, UsersController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        SetupService,
        UsersService,
        StartupMigrations,
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
