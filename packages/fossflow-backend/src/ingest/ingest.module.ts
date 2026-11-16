import { Global, Module } from '@nestjs/common';
import { IngestKeysController } from './ingest-keys.controller.js';
import { TrafficAggregator } from '../traffic/aggregator.js';
import { TrafficHub } from '../traffic/hub.js';
import { TrafficMaintenance } from '../traffic/maintenance.js';
import { IngestKeysService } from './ingest-keys.service.js';

/** Ingest keys: how services prove which project their traces belong to. */
@Global()
@Module({
  controllers: [IngestKeysController],
  providers: [IngestKeysService, TrafficAggregator, TrafficHub, TrafficMaintenance],
  exports: [IngestKeysService, TrafficAggregator, TrafficHub, TrafficMaintenance]
})
export class IngestModule {}
