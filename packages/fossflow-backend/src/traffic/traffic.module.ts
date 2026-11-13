import { Module } from '@nestjs/common';
import { TrafficController } from './traffic.controller.js';

/** Live traffic over server-sent events; the hub comes from the global IngestModule. */
@Module({ controllers: [TrafficController] })
export class TrafficModule {}
