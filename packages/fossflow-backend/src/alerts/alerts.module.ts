import { Global, Module } from '@nestjs/common';
import { DELIVERY_SLEEP, DeliveriesService, sleep } from './deliveries.js';
import { DELIVERIES } from './deliveries.token.js';
import { AlertEvaluator } from './evaluator.js';
import { IngestHeartbeat } from './heartbeat.js';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';

/** Alert rules and their history, and the evaluator that moves them between ok and firing. */
@Global()
@Module({
  controllers: [RulesController],
  providers: [RulesService, IngestHeartbeat, AlertEvaluator, DeliveriesService,
    { provide: DELIVERY_SLEEP, useValue: sleep },
    { provide: DELIVERIES, useExisting: DeliveriesService }],
  exports: [RulesService]
})
export class AlertsModule {}
