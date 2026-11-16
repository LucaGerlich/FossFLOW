import { Global, Module } from '@nestjs/common';
import { postJson, POST_JSON } from '../connectors/outbound.js';
import { LiveController } from '../live/live.controller.js';
import { LiveSourcesService } from '../live/live-sources.service.js';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { EnvBeszelMigration } from './env-beszel-migration.js';

/** Credentials: live sources and alert channels. */
@Global()
@Module({
  controllers: [CredentialsController, LiveController],
  providers: [{ provide: POST_JSON, useValue: postJson }, CredentialsService, LiveSourcesService, EnvBeszelMigration],
  exports: [POST_JSON, CredentialsService, LiveSourcesService, EnvBeszelMigration]
})
export class CredentialsModule {}
