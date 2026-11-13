import { Global, Module } from '@nestjs/common';
import { IngestKeysController } from './ingest-keys.controller.js';
import { TrafficAggregator } from '../traffic/aggregator.js';
import { IngestKeysService } from './ingest-keys.service.js';

/** Ingest keys: how services prove which project their traces belong to. */
@Global()
@Module({
  controllers: [IngestKeysController],
  providers: [IngestKeysService, TrafficAggregator],
  exports: [IngestKeysService, TrafficAggregator]
})
export class IngestModule {}
