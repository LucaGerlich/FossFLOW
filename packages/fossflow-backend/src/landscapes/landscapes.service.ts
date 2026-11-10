import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database/database.module.js';
import { landscape, landscapeSource, project, projectRelation, user } from '../database/schema.js';
import { ProjectAccess } from '../projects/project-access.js';
import { hasInstanceScope } from '../rbac/roles.js';
import { emptyModel, type LandscapeModel, withoutBuiltInIcons } from './model.js';

interface Viewer {
  id: string;
  instanceRole: string;
}

export interface LandscapeSummary {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  projectType: 'personal' | 'team';
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
}

const editor = alias(user, 'editor');

const summaryColumns = {
  id: landscape.id,
  name: landscape.name,
  projectId: landscape.projectId,
  projectName: project.name,
  projectType: project.type,
  version: landscape.version,
  updatedAt: landscape.updatedAt,
  updatedByName: editor.name
};

@Injectable()
export class LandscapesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: ProjectAccess
  ) {}

  /** Landscapes in every project you can see (n8n's Overview). */
  listVisible(viewer: Viewer): Promise<LandscapeSummary[]> {
    const manageAll = hasInstanceScope(viewer.instanceRole, 'project:manageAll');
    return this.db
      .select(summaryColumns)
      .from(landscape)
      .innerJoin(project, eq(project.id, landscape.projectId))
      .leftJoin(
        projectRelation,
        and(eq(projectRelation.projectId, project.id), eq(projectRelation.userId, viewer.id))
      )
      .leftJoin(editor, eq(editor.id, landscape.updatedBy))
      .where(
        manageAll
          ? or(isNotNull(projectRelation.userId), eq(project.type, 'team'))
          : isNotNull(projectRelation.userId)
      )
      .orderBy(desc(landscape.updatedAt));
  }

  listInProject(projectId: string): Promise<LandscapeSummary[]> {
    return this.db
      .select(summaryColumns)
      .from(landscape)
      .innerJoin(project, eq(project.id, landscape.projectId))
      .leftJoin(editor, eq(editor.id, landscape.updatedBy))
      .where(eq(landscape.projectId, projectId))
      .orderBy(desc(landscape.updatedAt));
  }

  async create(
    projectId: string,
    authorId: string,
    input: { name: string; model?: LandscapeModel | undefined }
  ): Promise<{ id: string; version: number }> {
    const id = randomUUID();
    const model = withoutBuiltInIcons({ ...(input.model ?? emptyModel(input.name)), title: input.name });
    await this.db.insert(landscape).values({
      id,
      projectId,
      name: input.name,
      model,
      createdBy: authorId,
      updatedBy: authorId
    });
    return { id, version: 1 };
  }

  async get(id: string) {
    const [row] = await this.db
      .select({ ...summaryColumns, model: landscape.model })
      .from(landscape)
      .innerJoin(project, eq(project.id, landscape.projectId))
      .leftJoin(editor, eq(editor.id, landscape.updatedBy))
      .where(eq(landscape.id, id));
    if (!row) throw new NotFoundException({ error: 'Landscape not found' });
    return row;
  }

  /**
   * Saves a new model if it is based on the current version. Otherwise
   * answers 409 with who saved last, so the editor can offer reload or
   * overwrite instead of silently replacing someone's work.
   */
  async save(
    id: string,
    authorId: string,
    input: { model: LandscapeModel; baseVersion: number }
  ): Promise<{ version: number }> {
    const [saved] = await this.db
      .update(landscape)
      .set({
        model: withoutBuiltInIcons(input.model),
        version: input.baseVersion + 1,
        updatedBy: authorId,
        updatedAt: new Date()
      })
      .where(and(eq(landscape.id, id), eq(landscape.version, input.baseVersion)))
      .returning({ version: landscape.version });
    if (saved) return saved;

    const current = await this.get(id);
    throw new ConflictException({
      error: 'Someone else saved this landscape in the meantime',
      currentVersion: current.version,
      updatedAt: current.updatedAt,
      updatedByName: current.updatedByName
    });
  }

  async rename(id: string, authorId: string, name: string): Promise<void> {
    const current = await this.get(id);
    const model = { ...(current.model as LandscapeModel), title: name };
    await this.db
      .update(landscape)
      .set({ name, model, version: current.version + 1, updatedBy: authorId, updatedAt: new Date() })
      .where(eq(landscape.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(landscape).where(eq(landscape.id, id));
  }

  /**
   * Moves a landscape; you need to be able to create landscapes in the target.
   * Its live sources are detached: credentials never leave their project.
   */
  async move(id: string, viewer: Viewer, targetProjectId: string): Promise<void> {
    const target = await this.access.resolve(viewer, targetProjectId);
    if (!target) throw new NotFoundException({ error: 'Project not found' });
    if (!target.scopes.has('landscape:create')) {
      throw new ForbiddenException({ error: 'You can’t add landscapes to that project' });
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(landscape)
        .set({ projectId: targetProjectId, updatedAt: new Date() })
        .where(eq(landscape.id, id));
      await tx.delete(landscapeSource).where(eq(landscapeSource.landscapeId, id));
    });
  }
}
