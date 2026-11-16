import { Global, Module } from '@nestjs/common';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';

/** Alert rules and their history; the evaluator and senders join in later tasks. */
@Global()
@Module({
  controllers: [RulesController],
  providers: [RulesService],
  exports: [RulesService]
})
export class AlertsModule {}
