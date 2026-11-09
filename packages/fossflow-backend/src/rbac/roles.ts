/**
 * Instance roles and the scopes they grant, named like n8n's
 * (`resource:action`). Custom roles (phase 4) will be rows with the same scopes.
 */
export const INSTANCE_ROLES = ['global:owner', 'global:admin', 'global:member'] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

export type InstanceScope = 'user:list' | 'user:invite' | 'user:resetPassword';

const ADMIN_SCOPES: readonly InstanceScope[] = [
  'user:list',
  'user:invite',
  'user:resetPassword'
];

const INSTANCE_ROLE_SCOPES: Record<InstanceRole, readonly InstanceScope[]> = {
  'global:owner': ADMIN_SCOPES,
  'global:admin': ADMIN_SCOPES,
  'global:member': []
};

export function isInstanceRole(value: unknown): value is InstanceRole {
  return INSTANCE_ROLES.includes(value as InstanceRole);
}

export function hasInstanceScope(role: string, scope: InstanceScope): boolean {
  return isInstanceRole(role) && INSTANCE_ROLE_SCOPES[role].includes(scope);
}

/**
 * Who may act on another account (reset its password; later: change its
 * role or delete it). The owner manages everyone; admins manage members.
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
