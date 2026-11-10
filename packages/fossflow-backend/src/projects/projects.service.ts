import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, ne, notExists, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscape, project, projectRelation, user } from '../database/schema.js';
import { ProjectAccess } from './project-access.js';
import { hasInstanceScope, projectScopesFor, type TeamProjectRole } from '../rbac/roles.js';

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

export interface ProjectSummary {
  id: string;
  name: string;
  type: 'personal' | 'team';
  /** Your membership role; null when you see it through an instance role. */
  role: string | null;
  scopes: string[];
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface Viewer {
  id: string;
  instanceRole: string;
}

@Injectable()
export class ProjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Projects');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: ProjectAccess
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const created = await this.ensurePersonalProjects();
    if (created > 0) this.logger.log(`Created ${created} personal project(s)`);
  }

  /** Every user has a personal project, including users from before projects existed. */
  async ensurePersonalProjects(): Promise<number> {
    const missing = await this.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        notExists(
          this.db
            .select({ one: sql`1` })
            .from(projectRelation)
            .where(
              and(
                eq(projectRelation.userId, user.id),
                eq(projectRelation.role, 'project:personalOwner')
              )
            )
        )
      );
    for (const each of missing) await this.createPersonalProject(each.id, each.name);
    return missing.length;
  }

  async createPersonalProject(userId: string, name: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const id = randomUUID();
        await tx.insert(project).values({ id, name, type: 'personal' });
        await tx
          .insert(projectRelation)
          .values({ projectId: id, userId, role: 'project:personalOwner' });
      });
    } catch (error) {
      // Someone else created it at the same moment; the unique index kept one.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /** Your projects; owners and admins also see every team project. */
  async listVisible(viewer: Viewer): Promise<ProjectSummary[]> {
    const manageAll = hasInstanceScope(viewer.instanceRole, 'project:manageAll');
    const rows = await this.db
      .select({
        id: project.id,
        name: project.name,
        type: project.type,
        role: projectRelation.role
      })
      .from(project)
      .leftJoin(
        projectRelation,
        and(eq(projectRelation.projectId, project.id), eq(projectRelation.userId, viewer.id))
      )
      .where(
        manageAll
          ? or(isNotNull(projectRelation.userId), eq(project.type, 'team'))
          : isNotNull(projectRelation.userId)
      )
      .orderBy(desc(project.type), asc(project.name));

    return rows.map((row) => ({
      ...row,
      scopes: [...projectScopesFor(viewer.instanceRole, row.role)]
    }));
  }

  async createTeam(creatorId: string, name: string): Promise<{ id: string }> {
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(project).values({ id, name, type: 'team' });
      await tx
        .insert(projectRelation)
        .values({ projectId: id, userId: creatorId, role: 'project:admin' });
    });
    return { id };
  }

  async rename(projectId: string, name: string): Promise<void> {
    await this.requireTeam(projectId);
    await this.db.update(project).set({ name }).where(eq(project.id, projectId));
  }

  /**
   * Deletes a team project. Its landscapes and credentials move to `transferTo` when given
   * (you need to be able to add landscapes there); otherwise they go too.
   */
  async remove(projectId: string, viewer: Viewer, transferTo?: string): Promise<void> {
    await this.requireTeam(projectId);
    if (transferTo !== undefined) {
      if (transferTo === projectId) {
        throw new BadRequestException({ error: 'Choose a different project' });
      }
      const target = await this.access.resolve(viewer, transferTo);
      if (!target) throw new NotFoundException({ error: 'Project not found' });
      if (!target.scopes.has('landscape:create')) {
        throw new ForbiddenException({ error: 'You can’t add landscapes to that project' });
      }
    }
    await this.db.transaction(async (tx) => {
      if (transferTo !== undefined) {
        await tx
          .update(landscape)
          .set({ projectId: transferTo })
          .where(eq(landscape.projectId, projectId));
        // Credentials go along, so the moved landscapes keep their live sources.
        await tx
          .update(credential)
          .set({ projectId: transferTo })
          .where(eq(credential.projectId, projectId));
      }
      await tx.delete(project).where(eq(project.id, projectId));
    });
  }

  members(projectId: string): Promise<ProjectMember[]> {
    return this.db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: projectRelation.role
      })
      .from(projectRelation)
      .innerJoin(user, eq(user.id, projectRelation.userId))
      .where(eq(projectRelation.projectId, projectId))
      .orderBy(asc(user.name));
  }

  /** Accounts that aren't in the project yet, for the "add member" picker. */
  candidates(projectId: string): Promise<{ id: string; name: string; email: string }[]> {
    return this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        notExists(
          this.db
            .select({ one: sql`1` })
            .from(projectRelation)
            .where(
              and(eq(projectRelation.projectId, projectId), eq(projectRelation.userId, user.id))
            )
        )
      )
      .orderBy(asc(user.name));
  }

  /** Adds a member or changes their role. */
  async setMember(projectId: string, userId: string, role: TeamProjectRole): Promise<void> {
    await this.requireTeam(projectId);
    const [target] = await this.db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!target) throw new NotFoundException({ error: 'User not found' });
    if (role !== 'project:admin') await this.keepAnAdmin(projectId, userId);

    await this.db
      .insert(projectRelation)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({
        target: [projectRelation.projectId, projectRelation.userId],
        set: { role }
      });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.requireTeam(projectId);
    await this.keepAnAdmin(projectId, userId);
    const removed = await this.db
      .delete(projectRelation)
      .where(and(eq(projectRelation.projectId, projectId), eq(projectRelation.userId, userId)))
      .returning({ userId: projectRelation.userId });
    if (removed.length === 0) throw new NotFoundException({ error: 'Not a member' });
  }

  /** A team project always keeps at least one project admin. */
  private async keepAnAdmin(projectId: string, leavingUserId: string): Promise<void> {
    const [current] = await this.db
      .select({ role: projectRelation.role })
      .from(projectRelation)
      .where(
        and(eq(projectRelation.projectId, projectId), eq(projectRelation.userId, leavingUserId))
      );
    if (current?.role !== 'project:admin') return;

    const [others] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectRelation)
      .where(
        and(
          eq(projectRelation.projectId, projectId),
          eq(projectRelation.role, 'project:admin'),
          ne(projectRelation.userId, leavingUserId)
        )
      );
    if ((others?.count ?? 0) === 0) {
      throw new ConflictException({ error: 'A project needs at least one admin' });
    }
  }

  private async requireTeam(projectId: string): Promise<void> {
    const [row] = await this.db
      .select({ type: project.type })
      .from(project)
      .where(eq(project.id, projectId));
    if (!row) throw new NotFoundException({ error: 'Project not found' });
    if (row.type !== 'team') {
      throw new BadRequestException({ error: 'Personal projects can’t be renamed, deleted or shared' });
    }
  }
}

/** The first owner and their personal project, where one-time imports land. */
export async function findOwnerHome(
  db: Database
): Promise<{ ownerId: string; projectId: string } | null> {
  const [row] = await db
    .select({ ownerId: user.id, projectId: projectRelation.projectId })
    .from(user)
    .innerJoin(
      projectRelation,
      and(eq(projectRelation.userId, user.id), eq(projectRelation.role, 'project:personalOwner'))
    )
    .where(eq(user.instanceRole, 'global:owner'))
    .orderBy(asc(user.createdAt))
    .limit(1);
  return row ?? null;
}
