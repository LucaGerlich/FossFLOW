import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Field, FormError } from '../components/AuthCard';
import { CopyLink } from '../components/CopyLink';
import { type UserSummary, UserRow } from '../components/UserRow';
import { type InstanceRole, roleLabelKey, type SessionUser } from '../session';
import { useSubmit } from '../useSubmit';

interface PendingInvite {
  id: string;
  email: string;
  instanceRole: InstanceRole;
  expiresAt: string;
}

interface CreatedInvite extends PendingInvite {
  url: string;
  emailed: boolean;
}

export function UsersPage({ me }: { me: SessionUser }) {
  const { t, i18n } = useTranslation('app');
  const queryClient = useQueryClient();
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserSummary[]>('/api/users') });
  const invites = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api<PendingInvite[]>('/api/invitations')
  });

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InstanceRole>('global:member');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [resetLink, setResetLink] = useState<{ name: string; url: string } | null>(null);

  const invite = useSubmit(async () => {
    const result = await api<CreatedInvite>('/api/invitations', {
      method: 'POST',
      body: { email, instanceRole: role }
    });
    setCreated(result);
    setInviting(false);
    setEmail('');
    await queryClient.invalidateQueries({ queryKey: ['invitations'] });
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] })
  });

  const makeResetLink = useMutation({
    mutationFn: (user: UserSummary) =>
      api<{ url: string }>(`/api/users/${user.id}/password-reset-link`, { method: 'POST' }),
    onSuccess: (result, user) => setResetLink({ name: user.name, url: result.url })
  });

  return (
    <>
      <header className="page__header">
        <h1 className="page__title">{t('platform.users.title')}</h1>
        {!inviting && (
          <button className="btn btn--primary" type="button" onClick={() => setInviting(true)}>
            {t('platform.users.invite')}
          </button>
        )}
      </header>

      {inviting && (
        <form className="panel" onSubmit={invite.onSubmit}>
          <h2 className="panel__title">{t('platform.users.inviteTitle')}</h2>
          <div className="panel__row">
            <Field label={t('platform.fields.email')} name="email" type="email" value={email} onChange={setEmail} autoFocus />
            <label className="field">
              <span className="field__label">{t('platform.fields.role')}</span>
              <select
                className="field__input"
                value={role}
                onChange={(event) => setRole(event.target.value as InstanceRole)}
              >
                <option value="global:member">{t('platform.roles.member')}</option>
                {me.instanceRole === 'global:owner' && (
                  <option value="global:admin">{t('platform.roles.admin')}</option>
                )}
              </select>
            </label>
          </div>
          <FormError message={invite.error} />
          <div className="panel__actions">
            <button className="btn" type="button" onClick={() => setInviting(false)}>
              {t('platform.users.cancel')}
            </button>
            <button className="btn btn--primary" type="submit" disabled={invite.busy}>
              {t('platform.users.inviteSubmit')}
            </button>
          </div>
        </form>
      )}

      {created && (
        <CopyLink
          title={t('platform.users.linkTitle')}
          hint={
            created.emailed
              ? t('platform.users.emailedHint', { email: created.email })
              : t('platform.users.linkHint', { email: created.email })
          }
          url={created.url}
          onClose={() => setCreated(null)}
        />
      )}
      {resetLink && (
        <CopyLink
          title={t('platform.users.resetTitle')}
          hint={t('platform.users.resetHint', { name: resetLink.name })}
          url={resetLink.url}
          onClose={() => setResetLink(null)}
        />
      )}

      <section className="list" aria-label={t('platform.users.title')}>
        {users.data?.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            me={me}
            everyone={users.data}
            onResetLink={(target) => makeResetLink.mutate(target)}
            resetBusy={makeResetLink.isPending}
          />
        ))}
      </section>

      <h2 className="section-title">{t('platform.users.pending')}</h2>
      {invites.data?.length ? (
        <section className="list" aria-label={t('platform.users.pending')}>
          {invites.data.map((pending) => (
            <div className="list__row" key={pending.id}>
              <div className="list__main">
                <span className="list__title">{pending.email}</span>
                <span className="list__meta">
                  {t('platform.users.expires', { date: formatDate(pending.expiresAt) })}
                </span>
              </div>
              <span className="badge">{t(roleLabelKey(pending.instanceRole))}</span>
              <div className="list__actions">
                <button
                  className="btn btn--sm btn--danger"
                  type="button"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(pending.id)}
                >
                  {t('platform.users.revoke')}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="empty-state empty-state--inline">{t('platform.users.noPending')}</p>
      )}
    </>
  );
}
