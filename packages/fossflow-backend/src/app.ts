import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import type { Express } from 'express';
import { AppModule } from './app.module.js';
import { AUTH, type Auth } from './auth/auth.js';
import type { AppConfig } from './config/config.js';
import { IngestKeysService } from './ingest/ingest-keys.service.js';
import { createOtlpHandler } from './ingest/otlp-handler.js';
import { TrafficAggregator } from './traffic/aggregator.js';
import { TrafficHub } from './traffic/hub.js';

/** Builds the configured app without listening; shared by main.ts and tests. */
export async function createApp(
  config: AppConfig
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    {
      // better-auth reads the raw body, so its handler goes before the JSON parser.
      bodyParser: false,
      logger: process.env.NODE_ENV === 'test' ? false : undefined
    }
  );
  // nginx on the same host is the only proxy; trust its X-Forwarded-For.
  app.set('trust proxy', 'loopback');

  const server = app.getHttpAdapter().getInstance() as Express;
  server.all('/api/auth/*splat', toNodeHandler(app.get<Auth>(AUTH)));
  // The OTLP endpoint reads its own raw body and authenticates by ingest key,
  // so it bypasses Nest's guards, throttler and JSON parser.
  server.post(
    '/api/otlp/v1/traces',
    createOtlpHandler({
      keys: app.get(IngestKeysService),
      aggregator: app.get(TrafficAggregator),
      hub: app.get(TrafficHub)
    })
  );
  app.useBodyParser('json', { limit: '10mb' });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
