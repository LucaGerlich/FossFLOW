import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { LiveModule } from './live/live.module.js';

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
        LiveModule
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: ThrottlerGuard }
      ],
      exports: [APP_CONFIG]
    };
  }
}
