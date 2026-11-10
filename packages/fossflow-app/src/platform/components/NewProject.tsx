import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { projectsKey } from '../projects';
import { useSubmit } from '../useSubmit';
import { FormError } from './AuthCard';

/** The sidebar's "+": names a new team project and opens it. */
export function NewProject() {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const { busy, error, onSubmit } = useSubmit(async () => {
    const created = await api<{ id: string }>('/api/projects', { method: 'POST', body: { name } });
    await queryClient.invalidateQueries({ queryKey: projectsKey });
    setOpen(false);
    setName('');
    navigate(`/projects/${created.id}/settings`);
  });

  if (!open) {
    return (
      <button
        className="icon-button"
        type="button"
        aria-label={t('platform.projects.create')}
        title={t('platform.projects.create')}
        onClick={() => setOpen(true)}
      >
        +
      </button>
    );
  }

  return (
    <div className="dialog-overlay" role="presentation" onClick={() => setOpen(false)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        onSubmit={onSubmit}
      >
        <h2 id="new-project-title">{t('platform.projects.create')}</h2>
        <p className="panel__hint">{t('platform.projects.createHint')}</p>
        <label className="field">
          <span className="field__label">{t('platform.fields.name')}</span>
          <input
            className="field__input"
            value={name}
            required
            autoFocus
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <FormError message={error} />
        <div className="dialog-buttons">
          <button className="btn" type="button" onClick={() => setOpen(false)}>
            {t('platform.users.cancel')}
          </button>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {t('platform.projects.createSubmit')}
          </button>
        </div>
      </form>
    </div>
  );
}
