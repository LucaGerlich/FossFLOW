import { Global, Module } from '@nestjs/common';
import { PROJECT_ACCESS_PROVIDERS, ProjectAccess } from './project-access.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Global()
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ...PROJECT_ACCESS_PROVIDERS],
  exports: [ProjectsService, ProjectAccess, ...PROJECT_ACCESS_PROVIDERS]
})
export class ProjectsModule {}
