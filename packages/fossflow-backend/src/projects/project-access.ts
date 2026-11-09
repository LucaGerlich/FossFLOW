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
import { landscape, project, projectRelation } from '../database/schema.js';
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

/** Which record the route parameter names; its project decides access. */
type ScopeTarget = 'project' | 'landscape';

interface ProjectScopeRule {
  scope: ProjectScope;
  param: string;
  target: ScopeTarget;
}

@Injectable()
class ProjectScopeGuard implements CanActivate {
  constructor(
    private readonly access: ProjectAccess,
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<ProjectScopeRule>(PROJECT_SCOPE_KEY, context.getHandler());
    const request = context.switchToHttp().getRequest<ProjectRequest>();
    const viewer = request.auth?.user;
    const id = request.params[rule.param];
    const notFound = rule.target === 'landscape' ? 'Landscape not found' : 'Project not found';
    if (!viewer || typeof id !== 'string') throw new NotFoundException({ error: notFound });

    const projectId = rule.target === 'landscape' ? await this.projectOfLandscape(id) : id;
    const access = projectId ? await this.access.resolve(viewer, projectId) : null;
    if (!access) throw new NotFoundException({ error: notFound });
    if (!access.scopes.has(rule.scope)) {
      throw new ForbiddenException({ error: 'Not allowed in this project' });
    }
    request.projectAccess = access;
    return true;
  }

  private async projectOfLandscape(landscapeId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ projectId: landscape.projectId })
      .from(landscape)
      .where(eq(landscape.id, landscapeId));
    return row?.projectId ?? null;
  }
}

/**
 * The signed-in user needs `scope` in the project named by the route
 * parameter (default `:id`), or in the project that holds the landscape it
 * names. Anything you can't see answers 404, not 403.
 */
export const RequireProjectScope = (
  scope: ProjectScope,
  options: { param?: string; target?: ScopeTarget } = {}
) =>
  applyDecorators(
    SetMetadata(PROJECT_SCOPE_KEY, {
      scope,
      param: options.param ?? 'id',
      target: options.target ?? 'project'
    } satisfies ProjectScopeRule),
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
