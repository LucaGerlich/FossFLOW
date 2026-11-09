import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { loadConfig } from './config/config.js';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig(process.env);
  const app = await createApp(config);
  await app.listen(config.port, config.host);
  logger.log(`FossFLOW server listening on ${config.host}:${config.port}`);
}

bootstrap().catch((error: unknown) => {
  // Config and connection errors carry no secret values.
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
