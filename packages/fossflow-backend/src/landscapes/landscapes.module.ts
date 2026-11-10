import { Global, Module } from '@nestjs/common';
import { LandscapesController } from './landscapes.controller.js';
import { LandscapesService } from './landscapes.service.js';
import { LegacyImportService } from './legacy-import.service.js';

@Global()
@Module({
  controllers: [LandscapesController],
  providers: [LandscapesService, LegacyImportService],
  exports: [LandscapesService, LegacyImportService]
})
export class LandscapesModule {}
