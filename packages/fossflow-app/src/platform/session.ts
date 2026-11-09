import { useQuery } from '@tanstack/react-query';
import { appUrl } from '../basePath';
import { api } from './api';

export type InstanceRole = 'global:owner' | 'global:admin' | 'global:member';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  instanceRole: InstanceRole;
}

export const sessionKey = ['session'] as const;

/** The signed-in user, or null. better-auth answers `null` without a session. */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () =>
      (await api<{ user: SessionUser } | null>('/api/auth/get-session'))?.user ?? null,
    staleTime: 60_000
  });
}

/** i18n key for a role label; i18next reads ':' as a namespace separator, so drop the prefix. */
export const roleLabelKey = (role: string) => `platform.roles.${role.split(':').pop()}`;

export const isAdmin = (user: SessionUser | null | undefined) =>
  user?.instanceRole === 'global:owner' || user?.instanceRole === 'global:admin';

export const signIn = (email: string, password: string) =>
  api('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });

export const signOut = () => api('/api/auth/sign-out', { method: 'POST', body: {} });

export const requestPasswordReset = (email: string) =>
  api('/api/auth/request-password-reset', {
    method: 'POST',
    body: { email, redirectTo: appUrl('/reset-password') }
  });

export const resetPassword = (token: string, newPassword: string) =>
  api('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
