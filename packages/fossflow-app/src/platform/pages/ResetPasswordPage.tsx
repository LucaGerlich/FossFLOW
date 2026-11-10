import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthCard, Field, FormError } from '../components/AuthCard';
import { resetPassword } from '../session';
import { useSubmit } from '../useSubmit';

/** Reached from an emailed or admin-made reset link (`?token=`). */
export function ResetPasswordPage() {
  const { t } = useTranslation('app');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  const { busy, error, onSubmit } = useSubmit(async () => {
    await resetPassword(token, password);
    setDone(true);
  });

  if (!token || params.get('error')) {
    return (
      <AuthCard title={t('platform.reset.title')}>
        <p className="note note--warning">{t('platform.reset.invalid')}</p>
        <Link className="link-button" to="/signin">
          {t('platform.signIn.backToSignIn')}
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title={t('platform.reset.title')}>
        <p className="note note--info">{t('platform.reset.done')}</p>
        <Link className="btn btn--primary btn--block" to="/signin">
          {t('platform.signIn.submit')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('platform.reset.title')}>
      <form className="auth-form" onSubmit={onSubmit}>
        <Field
          label={t('platform.fields.newPassword')}
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={t('platform.passwordHint')}
          autoFocus
        />
        <FormError message={error} />
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {t('platform.reset.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
