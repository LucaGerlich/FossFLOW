import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api';
import { type InstanceRole, roleLabelKey, type SessionUser } from '../session';
import { useSubmit } from '../useSubmit';
import { FormError } from './AuthCard';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  instanceRole: InstanceRole;
  createdAt: string;
}

/** Mirrors the server rule: the owner manages everyone, admins manage members. */
export const canManage = (actor: InstanceRole, target: InstanceRole) =>
  actor === 'global:owner' || (actor === 'global:admin' && target === 'global:member');

/** Mirrors the server: only the owner hands out admin, and nobody hands out owner. */
const grantable = (actor: InstanceRole): InstanceRole[] =>
  actor === 'global:owner' ? ['global:admin', 'global:member'] : ['global:member'];

interface UserRowProps {
  user: UserSummary;
  me: SessionUser;
  everyone: UserSummary[];
  onResetLink: (user: UserSummary) => void;
  resetBusy: boolean;
}

/** One account in Settings → Users: role, reset link, delete with hand-over. */
export function UserRow({ user, me, everyone, onResetLink, resetBusy }: UserRowProps) {
  const { t, i18n } = useTranslation('app');
  const queryClient = useQueryClient();
  const manageable = user.id !== me.id && canManage(me.instanceRole, user.instanceRole);
  const roles = grantable(me.instanceRole);
  const [confirming, setConfirming] = useState(false);
  /** Who takes over their personal work; '' deletes it with the account. */
  const [heir, setHeir] = useState(me.id);
  const [roleError, setRoleError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const changeRole = useMutation({
    mutationFn: (instanceRole: InstanceRole) =>
      api(`/api/users/${user.id}`, { method: 'PATCH', body: { instanceRole } }),
    onMutate: () => setRoleError(null),
    onSuccess: refresh,
    onError: (caught) => setRoleError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'))
  });

  const remove = useSubmit(async () => {
    const query = heir ? `?transferTo=${encodeURIComponent(heir)}` : '';
    await api(`/api/users/${user.id}${query}`, { method: 'DELETE' });
    await refresh();
  });

  const joined = new Date(user.createdAt).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          <span className="list__title">
            {user.name}
            {user.id === me.id && <span className="list__muted"> ({t('platform.users.you')})</span>}
          </span>
          <span className="list__meta">{user.email}</span>
        </div>
        {manageable && roles.length > 1 ? (
          <select
            className="field__input field__input--compact"
            aria-label={t('platform.users.roleOf', { name: user.name })}
            value={user.instanceRole}
            disabled={changeRole.isPending}
            onChange={(event) => changeRole.mutate(event.target.value as InstanceRole)}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {t(roleLabelKey(role))}
              </option>
            ))}
          </select>
        ) : (
          <span className="badge">{t(roleLabelKey(user.instanceRole))}</span>
        )}
        <span className="list__meta list__meta--fixed">{t('platform.users.joined', { date: joined })}</span>
        <div className="list__actions">
          {manageable && (
            <button className="btn btn--sm" type="button" disabled={resetBusy} onClick={() => onResetLink(user)}>
              {t('platform.users.resetLink')}
            </button>
          )}
          {manageable && !confirming && (
            <button className="btn btn--sm btn--danger" type="button" onClick={() => setConfirming(true)}>
              {t('platform.users.delete')}
            </button>
          )}
        </div>
      </div>
      <FormError message={roleError} />
      {confirming && (
        <form className="inline-form" onSubmit={remove.onSubmit}>
          <label className="list__muted" htmlFor={`heir-${user.id}`}>
            {t('platform.users.transferLabel')}
          </label>
          <select
            id={`heir-${user.id}`}
            className="field__input field__input--compact"
            value={heir}
            onChange={(event) => setHeir(event.target.value)}
          >
            {everyone
              .filter((candidate) => candidate.id !== user.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id === me.id ? t('platform.users.transferToMe') : candidate.name}
                </option>
              ))}
            <option value="">{t('platform.users.transferNone')}</option>
          </select>
          <button className="btn btn--sm" type="button" onClick={() => setConfirming(false)}>
            {t('platform.users.cancel')}
          </button>
          <button className="btn btn--sm btn--danger-solid" type="submit" disabled={remove.busy}>
            {t('platform.users.deleteConfirm', { name: user.name })}
          </button>
        </form>
      )}
      <FormError message={remove.error} />
    </div>
  );
}
