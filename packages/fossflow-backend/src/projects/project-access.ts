import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { AuthenticatedRequest } from '../auth/guards.js';
import { DB, type Database } from '../database/database.module.js';
import { project, projectRelation } from '../database/schema.js';
import { type ProjectScope, projectScopesFor } from '../rbac/roles.js';

export interface ProjectAccessInfo {
  projectId: string;
  name: string;
  type: 'personal' | 'team';
  role: string | null;
  scopes: ReadonlySet<ProjectScope>;
}

interface ProjectRequest extends AuthenticatedRequest {
  projectAccess?: ProjectAccessInfo;
}

/** Works out what one user may do in one project. */
@Injectable()
export class ProjectAccess {
  constructor(@Inject(DB) private readonly db: Database) {}

  async resolve(
    viewer: { id: string; instanceRole: string },
    projectId: string
  ): Promise<ProjectAccessInfo | null> {
    const [row] = await this.db
      .select({ id: project.id, name: project.name, type: project.type, role: projectRelation.role })
      .from(project)
      .leftJoin(
        projectRelation,
        and(eq(projectRelation.projectId, project.id), eq(projectRelation.userId, viewer.id))
      )
      .where(eq(project.id, projectId));
    if (!row) return null;

    const scopes = projectScopesFor(viewer.instanceRole, row.role);
    // No scopes means not visible: answer as if it didn't exist.
    if (scopes.size === 0) return null;
    return { projectId: row.id, name: row.name, type: row.type, role: row.role, scopes };
  }
}

const PROJECT_SCOPE_KEY = 'fossflow:projectScope';

@Injectable()
class ProjectScopeGuard implements CanActivate {
  constructor(
    private readonly access: ProjectAccess,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { scope, param } = this.reflector.get<{ scope: ProjectScope; param: string }>(
      PROJECT_SCOPE_KEY,
      context.getHandler()
    );
    const request = context.switchToHttp().getRequest<ProjectRequest>();
    const viewer = request.auth?.user;
    const projectId = request.params[param];
    if (!viewer || typeof projectId !== 'string') {
      throw new NotFoundException({ error: 'Project not found' });
    }

    const access = await this.access.resolve(viewer, projectId);
    if (!access) throw new NotFoundException({ error: 'Project not found' });
    if (!access.scopes.has(scope)) {
      throw new ForbiddenException({ error: 'Not allowed in this project' });
    }
    request.projectAccess = access;
    return true;
  }
}

/**
 * The signed-in user needs `scope` in the project named by the route
 * parameter (default `:id`). Projects you can't see answer 404, not 403.
 */
export const RequireProjectScope = (scope: ProjectScope, param = 'id') =>
  applyDecorators(
    SetMetadata(PROJECT_SCOPE_KEY, { scope, param }),
    UseGuards(ProjectScopeGuard)
  );

/** The access the guard resolved for this request. */
export const CurrentProject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProjectAccessInfo => {
    const access = context.switchToHttp().getRequest<ProjectRequest>().projectAccess;
    if (!access) throw new NotFoundException({ error: 'Project not found' });
    return access;
  }
);

export const PROJECT_ACCESS_PROVIDERS = [ProjectAccess, ProjectScopeGuard];
