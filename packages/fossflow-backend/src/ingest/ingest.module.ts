import { Global, Module } from '@nestjs/common';
import { IngestKeysController } from './ingest-keys.controller.js';
import { IngestKeysService } from './ingest-keys.service.js';

/** Ingest keys: how services prove which project their traces belong to. */
@Global()
@Module({
  controllers: [IngestKeysController],
  providers: [IngestKeysService],
  exports: [IngestKeysService]
})
export class IngestModule {}
