import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard, Field, FormError } from '../components/AuthCard';
import { requestPasswordReset, sessionKey, signIn } from '../session';
import { useSubmit } from '../useSubmit';

export function SignInPage({ mailEnabled }: { mailEnabled: boolean }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const signInForm = useSubmit(async () => {
    await signIn(email, password);
    await queryClient.invalidateQueries({ queryKey: sessionKey });
    navigate(from, { replace: true });
  });

  const forgotForm = useSubmit(async () => {
    await requestPasswordReset(email);
    setResetSent(true);
  });

  if (forgot) {
    return (
      <AuthCard title={t('platform.signIn.forgot')}>
        {resetSent ? (
          <p className="note note--info">{t('platform.signIn.forgotSent')}</p>
        ) : (
          <form className="auth-form" onSubmit={forgotForm.onSubmit}>
            <Field label={t('platform.fields.email')} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} autoFocus />
            <FormError message={forgotForm.error} />
            <button className="btn btn--primary btn--block" type="submit" disabled={forgotForm.busy}>
              {t('platform.signIn.forgotSubmit')}
            </button>
          </form>
        )}
        <button className="link-button" type="button" onClick={() => setForgot(false)}>
          {t('platform.signIn.backToSignIn')}
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('platform.signIn.title')}>
      <form className="auth-form" onSubmit={signInForm.onSubmit}>
        <Field label={t('platform.fields.email')} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} autoFocus />
        <Field label={t('platform.fields.password')} name="password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        <FormError message={signInForm.error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={signInForm.busy}>
          {t('platform.signIn.submit')}
        </button>
      </form>
      {mailEnabled ? (
        <button className="link-button" type="button" onClick={() => setForgot(true)}>
          {t('platform.signIn.forgot')}
        </button>
      ) : (
        <p className="auth-card__footnote">{t('platform.signIn.noMail')}</p>
      )}
    </AuthCard>
  );
}
