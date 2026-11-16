import { Global, Module } from '@nestjs/common';
import { DELIVERIES, type Deliveries } from './deliveries.token.js';
import { AlertEvaluator } from './evaluator.js';
import { IngestHeartbeat } from './heartbeat.js';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';

/** Until the senders exist, nothing is delivered. */
const noDeliveries: Deliveries = { notify: async () => undefined };

/** Alert rules and their history, and the evaluator that moves them between ok and firing. */
@Global()
@Module({
  controllers: [RulesController],
  providers: [RulesService, IngestHeartbeat, AlertEvaluator, { provide: DELIVERIES, useValue: noDeliveries }],
  exports: [RulesService]
})
export class AlertsModule {}
