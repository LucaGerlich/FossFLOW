import { Module } from '@nestjs/common';
import { TrafficQueries } from './traffic-queries.js';
import { TrafficController } from './traffic.controller.js';

/** Live traffic over server-sent events, plus the summary and arrow detail reads; the hub comes from the global IngestModule. */
@Module({ controllers: [TrafficController], providers: [TrafficQueries] })
export class TrafficModule {}
