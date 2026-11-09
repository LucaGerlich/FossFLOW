import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';

/** Builds the configured app without listening; shared by main.ts and tests. */
export async function createApp(
  config: AppConfig
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    { logger: process.env.NODE_ENV === 'test' ? false : undefined }
  );
  // nginx on the same host is the only proxy; trust its X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
