import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { type CreatedIngestKey, ingestKeysKey } from '../monitoring';
import { useSubmit } from '../useSubmit';
import { Field, FormError } from './AuthCard';
import { SetupBlocks } from './SetupBlocks';

/**
 * Names a service, creates its key and shows the setup once. The raw key lives
 * in this component's state only and is dropped on Done.
 */
export function ConnectService({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedIngestKey | null>(null);
  const [copied, setCopied] = useState(false);

  const { busy, error, onSubmit } = useSubmit(async () => {
    const result = await api<CreatedIngestKey>(`/api/projects/${encodeURIComponent(projectId)}/ingest-keys`, {
      method: 'POST',
      body: { name: name.trim() }
    });
    setCreated(result);
    await queryClient.invalidateQueries({ queryKey: ingestKeysKey(projectId) });
  });

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the key stays selectable in the field.
    }
  };

  if (created) {
    return (
      <section className="panel panel--link" aria-label={t('platform.monitoring.createdTitle', { name: created.name })}>
        <h2 className="panel__title">{t('platform.monitoring.createdTitle', { name: created.name })}</h2>
        <p className="panel__hint">{t('platform.monitoring.keyHint')}</p>
        <div className="copy-link">
          <input
            className="field__input copy-link__input"
            readOnly
            value={created.key}
            onFocus={(event) => event.target.select()}
            aria-label={t('platform.monitoring.keyLabel')}
          />
          <button className="btn btn--primary" type="button" onClick={() => copyKey(created.key)}>
            {copied ? t('platform.monitoring.copied') : t('platform.monitoring.copy')}
          </button>
        </div>
        <SetupBlocks blocks={created.setup} />
        <div className="panel__actions">
          <button className="btn" type="button" onClick={onClose}>
            {t('platform.monitoring.done')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2 className="panel__title">{t('platform.monitoring.connect')}</h2>
      <Field
        label={t('platform.monitoring.serviceName')}
        name="serviceName"
        value={name}
        onChange={setName}
        hint={t('platform.monitoring.serviceNameHint')}
        autoFocus
      />
      <FormError message={error} />
      <div className="panel__actions">
        <button className="btn" type="button" onClick={onClose}>
          {t('platform.users.cancel')}
        </button>
        <button className="btn btn--primary" type="submit" disabled={busy || name.trim() === ''}>
          {t('platform.monitoring.create')}
        </button>
      </div>
    </form>
  );
}
