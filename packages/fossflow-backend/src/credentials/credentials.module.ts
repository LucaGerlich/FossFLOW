import { Global, Module } from '@nestjs/common';
import { LiveController } from '../live/live.controller.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { EnvBeszelMigration } from './env-beszel-migration.js';

/** Credentials, and the live sources that run on them. */
@Global()
@Module({
  controllers: [CredentialsController, LiveController],
  providers: [CredentialsService, LiveSourcesService, EnvBeszelMigration],
  exports: [CredentialsService, LiveSourcesService, EnvBeszelMigration]
})
export class CredentialsModule {}
