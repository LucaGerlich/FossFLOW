import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, FormError } from '../components/AuthCard';
import { roleLabelKey } from '../session';
import { useSubmit } from '../useSubmit';

/** Accepting an invitation: the link sets name and password, then signs in. */
export function InvitePage() {
  const { t } = useTranslation('app');
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api<{ email: string; instanceRole: string }>(`/api/invitations/accept/${encodeURIComponent(token)}`),
    retry: false
  });

  const { busy, error, onSubmit } = useSubmit(async () => {
    await api(`/api/invitations/accept/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { name, password }
    });
    await queryClient.invalidateQueries();
    navigate('/', { replace: true });
  });

  if (invitation.isPending) {
    return <AuthCard title={t('platform.invite.title')}>{t('platform.loading')}</AuthCard>;
  }
  if (invitation.isError) {
    return (
      <AuthCard title={t('platform.invite.title')}>
        <p className="note note--warning">{t('platform.invite.invalid')}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('platform.invite.title')}
      intro={t('platform.invite.intro', {
        email: invitation.data.email,
        role: t(roleLabelKey(invitation.data.instanceRole))
      })}
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <Field label={t('platform.fields.name')} name="name" autoComplete="name" value={name} onChange={setName} autoFocus />
        <Field
          label={t('platform.fields.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={t('platform.passwordHint')}
        />
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {t('platform.invite.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
