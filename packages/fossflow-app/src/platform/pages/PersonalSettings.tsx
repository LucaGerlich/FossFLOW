import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Field, FormError } from '../components/AuthCard';
import { roleLabelKey, type SessionUser, sessionKey } from '../session';
import { useSubmit } from '../useSubmit';

/** Settings → Personal: your name and password, through better-auth's own routes. */
export function PersonalSettings({ me }: { me: SessionUser }) {
  const { t } = useTranslation('app');
  return (
    <>
      <header className="page__header">
        <h1 className="page__title">{t('platform.settings.personalTitle')}</h1>
      </header>
      <ProfilePanel me={me} />
      <PasswordPanel />
    </>
  );
}

function ProfilePanel({ me }: { me: SessionUser }) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.name);
  const [saved, setSaved] = useState(false);

  const save = useSubmit(async () => {
    setSaved(false);
    await api('/api/auth/update-user', { method: 'POST', body: { name } });
    setName(name.trim()); // what the server stored
    await queryClient.invalidateQueries({ queryKey: sessionKey });
    setSaved(true);
  });

  return (
    <form className="panel" onSubmit={save.onSubmit}>
      <h2 className="panel__title">{t('platform.settings.profile')}</h2>
      <div className="panel__row">
        <Field
          label={t('platform.fields.name')}
          name="name"
          autoComplete="name"
          value={name}
          onChange={(value) => {
            setName(value);
            setSaved(false);
          }}
        />
        <label className="field">
          <span className="field__label">{t('platform.fields.email')}</span>
          <input className="field__input" value={me.email} readOnly aria-describedby="email-hint" />
          <span id="email-hint" className="field__hint">
            {t('platform.settings.emailHint', { role: t(roleLabelKey(me.instanceRole)) })}
          </span>
        </label>
      </div>
      {saved && (
        <p className="note note--success" role="status">
          {t('platform.settings.saved')}
        </p>
      )}
      <FormError message={save.error} />
      <div className="panel__actions">
        <button className="btn btn--primary" type="submit" disabled={save.busy || name.trim() === me.name}>
          {t('platform.projects.save')}
        </button>
      </div>
    </form>
  );
}

function PasswordPanel() {
  const { t } = useTranslation('app');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changed, setChanged] = useState(false);

  const change = useSubmit(async () => {
    setChanged(false);
    await api('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword, revokeOtherSessions: true }
    });
    setCurrentPassword('');
    setNewPassword('');
    setChanged(true);
  });

  return (
    <form className="panel" onSubmit={change.onSubmit}>
      <h2 className="panel__title">{t('platform.settings.password')}</h2>
      <p className="panel__hint">{t('platform.settings.passwordHint')}</p>
      <div className="panel__row">
        <Field
          label={t('platform.settings.currentPassword')}
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <Field
          label={t('platform.fields.newPassword')}
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          hint={t('platform.passwordHint')}
        />
      </div>
      {changed && (
        <p className="note note--success" role="status">
          {t('platform.settings.passwordChanged')}
        </p>
      )}
      <FormError message={change.error} />
      <div className="panel__actions">
        <button className="btn btn--primary" type="submit" disabled={change.busy}>
          {t('platform.settings.changePassword')}
        </button>
      </div>
    </form>
  );
}
