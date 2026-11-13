/**
 * Roles and the scopes they grant, named like n8n's (`resource:action`).
 * Instance roles apply everywhere; project roles apply inside one project.
 * Custom roles (phase 4) will be stored rows built from the same scopes.
 */

// ── Instance ─────────────────────────────────────────────────────────────

export const INSTANCE_ROLES = ['global:owner', 'global:admin', 'global:member'] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export type InstanceScope =
  | 'user:list'
  | 'user:invite'
  | 'user:resetPassword'
  | 'user:changeRole'
  | 'user:delete'
  | 'project:create'
  /** See every project, and act in it with full project rights. */
  | 'project:manageAll';

const INSTANCE_ADMIN_SCOPES: readonly InstanceScope[] = [
  'user:list',
  'user:invite',
  'user:resetPassword',
  'user:changeRole',
  'user:delete',
  'project:create',
  'project:manageAll'
];

const INSTANCE_ROLE_SCOPES: Record<InstanceRole, readonly InstanceScope[]> = {
  'global:owner': INSTANCE_ADMIN_SCOPES,
  'global:admin': INSTANCE_ADMIN_SCOPES,
  'global:member': []
};

export function isInstanceRole(value: unknown): value is InstanceRole {
  return INSTANCE_ROLES.includes(value as InstanceRole);
}

export function hasInstanceScope(role: string, scope: InstanceScope): boolean {
  return isInstanceRole(role) && INSTANCE_ROLE_SCOPES[role].includes(scope);
}

/**
 * Who may act on another account (reset its password, change its role,
 * delete it). The owner manages everyone; admins manage members.
 */
export function canManageUser(actor: string, target: string): boolean {
  if (actor === 'global:owner') return true;
  return actor === 'global:admin' && target === 'global:member';
}

/**
 * Who may hand out a role. Only the owner can create admins: an admin who
 * could mint admins could escalate any account (n8n's docs warn about this).
 */
export function canGrantInstanceRole(actor: string, role: InstanceRole): boolean {
  if (role === 'global:owner') return false;
  if (role === 'global:admin') return actor === 'global:owner';
  return hasInstanceScope(actor, 'user:invite');
}

// ── Project ──────────────────────────────────────────────────────────────

/** Roles a member can be given in a team project. */
export const TEAM_PROJECT_ROLES = ['project:admin', 'project:editor', 'project:viewer'] as const;
export type TeamProjectRole = (typeof TEAM_PROJECT_ROLES)[number];
/** The single member of a personal project. */
export type ProjectRole = TeamProjectRole | 'project:personalOwner';

export const PROJECT_SCOPES = [
  'project:read',
  'project:update',
  'project:delete',
  'projectMember:manage',
  'landscape:create',
  'landscape:read',
  'landscape:update',
  'landscape:delete',
  'landscape:move',
  'credential:create',
  'credential:read',
  'credential:update',
  'credential:delete',
  'credential:use',
  'ingestKey:create',
  'ingestKey:read',
  'ingestKey:delete'
] as const;
export type ProjectScope = (typeof PROJECT_SCOPES)[number];

const CONTENT_SCOPES: readonly ProjectScope[] = [
  'landscape:create',
  'landscape:read',
  'landscape:update',
  'landscape:delete',
  'credential:create',
  'credential:read',
  'credential:update',
  'credential:delete',
  'credential:use',
  'ingestKey:create',
  'ingestKey:read',
  'ingestKey:delete'
];

const PROJECT_ROLE_SCOPES: Record<ProjectRole, readonly ProjectScope[]> = {
  // Your own space: everything inside it, but it can't be renamed, deleted or shared.
  'project:personalOwner': ['project:read', ...CONTENT_SCOPES, 'landscape:move'],
  'project:admin': PROJECT_SCOPES,
  'project:editor': ['project:read', ...CONTENT_SCOPES],
  // Read-only: sees landscapes and credential names, can't use credentials.
  'project:viewer': ['project:read', 'landscape:read', 'credential:read', 'ingestKey:read']
};

export function isTeamProjectRole(value: unknown): value is TeamProjectRole {
  return TEAM_PROJECT_ROLES.includes(value as TeamProjectRole);
}

/**
 * A user's scopes in one project: from their membership role, or every scope
 * when their instance role manages all projects (n8n's owner and admin).
 */
export function projectScopesFor(
  instanceRole: string,
  projectRole: string | null
): ReadonlySet<ProjectScope> {
  if (hasInstanceScope(instanceRole, 'project:manageAll')) return new Set(PROJECT_SCOPES);
  const scopes = projectRole ? PROJECT_ROLE_SCOPES[projectRole as ProjectRole] : undefined;
  return new Set(scopes ?? []);
}
