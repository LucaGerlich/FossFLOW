import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, FormError } from '../components/AuthCard';
import { useSubmit } from '../useSubmit';

/** First run: whoever opens a fresh instance creates the Owner account. */
export function SetupPage({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { busy, error, onSubmit } = useSubmit(async () => {
    await api('/api/setup/owner', { method: 'POST', body: { name, email, password } });
    onDone();
    await queryClient.invalidateQueries();
    navigate('/', { replace: true });
  });

  return (
    <AuthCard title={t('platform.setup.title')} intro={t('platform.setup.intro')}>
      <form className="auth-form" onSubmit={onSubmit}>
        <Field label={t('platform.fields.name')} name="name" autoComplete="name" value={name} onChange={setName} autoFocus />
        <Field label={t('platform.fields.email')} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
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
          {t('platform.setup.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
