import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database/database.module.js';
import { credential, landscape, project, projectRelation, user } from '../database/schema.js';

const otherAdmin = alias(projectRelation, 'other_admin');

export const ROLE_CHANGED = 'This person’s role just changed. Reload and try again.';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Deletes an account in one transaction. Their personal landscapes and
   * credentials move to `transferTo`'s personal project (live sources stay
   * attached, the credential ids don't change), or go with the account.
   * Sessions, logins and memberships go by cascade.
   */
  async remove(userId: string, expectedRole: string, transferTo?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Re-check under a row lock what the caller authorised against: the role may
      // have changed since (an admin may delete members, not someone just promoted).
      const [current] = await tx
        .select({ role: user.instanceRole })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!current) throw new NotFoundException({ error: 'User not found' });
      if (current.role !== expectedRole) throw new ConflictException({ error: ROLE_CHANGED });

      // Lock the admin rows of their projects, so deleting two co-admins at once
      // can't both pass the check below.
      await tx
        .select({ projectId: projectRelation.projectId })
        .from(projectRelation)
        .where(
          and(
            eq(projectRelation.role, 'project:admin'),
            inArray(
              projectRelation.projectId,
              tx
                .select({ projectId: projectRelation.projectId })
                .from(projectRelation)
                .where(and(eq(projectRelation.userId, userId), eq(projectRelation.role, 'project:admin')))
            )
          )
        )
        .for('update');

      // The FK cascade would quietly leave these projects without an admin.
      const stranded = await tx
        .select({ name: project.name })
        .from(projectRelation)
        .innerJoin(project, eq(project.id, projectRelation.projectId))
        .where(
          and(
            eq(projectRelation.userId, userId),
            eq(projectRelation.role, 'project:admin'),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(otherAdmin)
                .where(
                  and(
                    eq(otherAdmin.projectId, projectRelation.projectId),
                    eq(otherAdmin.role, 'project:admin'),
                    ne(otherAdmin.userId, userId)
                  )
                )
            )
          )
        )
        .orderBy(asc(project.name));
      if (stranded.length > 0) {
        const names = stranded.map((row) => row.name).join(', ');
        throw new ConflictException({
          error: `They are the only admin of ${names}. Make someone else admin there first.`
        });
      }

      const personalOf = async (id: string) =>
        (
          await tx
            .select({ id: projectRelation.projectId })
            .from(projectRelation)
            .where(and(eq(projectRelation.userId, id), eq(projectRelation.role, 'project:personalOwner')))
            .for('update') // the heir can't be deleted underneath us
        )[0]?.id;

      const from = await personalOf(userId);
      if (from && transferTo !== undefined) {
        const to = await personalOf(transferTo);
        if (!to) throw new NotFoundException({ error: 'User not found' });
        await tx.update(landscape).set({ projectId: to }).where(eq(landscape.projectId, from));
        await tx.update(credential).set({ projectId: to }).where(eq(credential.projectId, from));
      }
      // The personal project has no owner column, so the cascade from `user` misses it.
      if (from) await tx.delete(project).where(eq(project.id, from));
      await tx.delete(user).where(eq(user.id, userId));
    });
  }
}
