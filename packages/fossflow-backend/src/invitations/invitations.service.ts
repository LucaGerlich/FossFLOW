import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DB, type Database } from '../database/database.module.js';
import { invitation, user } from '../database/schema.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import { canGrantInstanceRole, type InstanceRole, isInstanceRole } from '../rbac/roles.js';
import { AccountsService } from '../users/accounts.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_VALID = 'This invitation is invalid, expired or already used';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PendingInvitation {
  id: string;
  email: string;
  instanceRole: string;
  createdAt: Date;
  expiresAt: Date;
}

interface Actor {
  id: string;
  name: string;
  instanceRole: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger('Invitations');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly accounts: AccountsService
  ) {}

  async create(
    actor: Actor,
    input: { email: string; instanceRole: InstanceRole }
  ): Promise<PendingInvitation & { url: string; emailed: boolean }> {
    if (!canGrantInstanceRole(actor.instanceRole, input.instanceRole)) {
      throw new ForbiddenException({ error: 'You can’t invite people with this role' });
    }
    const email = input.email.trim().toLowerCase();
    const [existing] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    if (existing) {
      throw new ConflictException({ error: 'An account with this email already exists' });
    }

    const token = randomBytes(32).toString('base64url');
    const row = {
      id: randomUUID(),
      email,
      instanceRole: input.instanceRole,
      tokenHash: hashToken(token),
      invitedBy: actor.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS)
    };
    await this.db.transaction(async (tx) => {
      // A new invitation replaces any pending one for the same address.
      await tx
        .delete(invitation)
        .where(and(eq(invitation.email, email), isNull(invitation.acceptedAt)));
      await tx.insert(invitation).values(row);
    });

    const url = `${this.config.publicUrl}/invite/${token}`;
    let emailed = false;
    if (this.mailer.enabled) {
      try {
        await this.mailer.sendInvitation(email, url, actor.name);
        emailed = true;
      } catch {
        this.logger.warn('Invitation created, but the email could not be sent');
      }
    }
    return {
      id: row.id,
      email,
      instanceRole: row.instanceRole,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      url,
      emailed
    };
  }

  listPending(): Promise<PendingInvitation[]> {
    return this.db
      .select({
        id: invitation.id,
        email: invitation.email,
        instanceRole: invitation.instanceRole,
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt
      })
      .from(invitation)
      .where(and(isNull(invitation.acceptedAt), gt(invitation.expiresAt, new Date())))
      .orderBy(desc(invitation.createdAt));
  }

  async revoke(id: string): Promise<void> {
    const removed = await this.db
      .delete(invitation)
      .where(and(eq(invitation.id, id), isNull(invitation.acceptedAt)))
      .returning({ id: invitation.id });
    if (removed.length === 0) throw new NotFoundException({ error: 'Invitation not found' });
  }

  /** What the invite page shows. Invalid, expired and used links look the same. */
  async lookup(token: string): Promise<{ email: string; instanceRole: string }> {
    const [row] = await this.db
      .select({ email: invitation.email, instanceRole: invitation.instanceRole })
      .from(invitation)
      .where(
        and(
          eq(invitation.tokenHash, hashToken(token)),
          isNull(invitation.acceptedAt),
          gt(invitation.expiresAt, new Date())
        )
      );
    if (!row) throw new NotFoundException({ error: NOT_VALID });
    return row;
  }

  /**
   * Claims the invitation atomically (a link works once, even if submitted
   * twice at the same moment), then creates the account.
   */
  async accept(
    token: string,
    input: { name: string; password: string }
  ): Promise<{ email: string }> {
    const [claimed] = await this.db
      .update(invitation)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(invitation.tokenHash, hashToken(token)),
          isNull(invitation.acceptedAt),
          gt(invitation.expiresAt, new Date())
        )
      )
      .returning({
        id: invitation.id,
        email: invitation.email,
        instanceRole: invitation.instanceRole
      });
    if (!claimed || !isInstanceRole(claimed.instanceRole)) {
      throw new NotFoundException({ error: NOT_VALID });
    }

    try {
      await this.accounts.createUser({
        name: input.name,
        email: claimed.email,
        password: input.password,
        instanceRole: claimed.instanceRole
      });
    } catch (error) {
      await this.db
        .update(invitation)
        .set({ acceptedAt: null })
        .where(eq(invitation.id, claimed.id));
      throw error;
    }
    return { email: claimed.email };
  }
}
