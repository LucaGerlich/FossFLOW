import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api';
import { type IngestKeySummary, ingestKeysKey } from '../monitoring';
import { can, type ProjectDetail } from '../projects';
import { FormError } from './AuthCard';

/** One service key: when it last delivered data, which services sent it, and Revoke. */
export function IngestKeyRow({ project, ingestKey }: { project: ProjectDetail; ingestKey: IngestKeySummary }) {
  const { t, i18n } = useTranslation('app');
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: () => api(`/api/ingest-keys/${ingestKey.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ingestKeysKey(project.id) }),
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'))
  });

  const format = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const meta = [
    `${ingestKey.prefix}…`,
    ingestKey.createdBy ? t('platform.monitoring.createdBy', { name: ingestKey.createdBy }) : null,
    ingestKey.lastUsedAt
      ? t('platform.monitoring.lastData', { date: format(ingestKey.lastUsedAt) })
      : t('platform.monitoring.noData')
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const seenAs = ingestKey.services
    .map((service) => `${service.name} (${format(service.lastSeenAt)})`)
    .join(', ');

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          <span className="list__title">{ingestKey.name}</span>
          <span className="list__meta">{meta}</span>
          {seenAs && <span className="list__meta">{t('platform.monitoring.seenAs', { services: seenAs })}</span>}
        </div>
        <div className="list__actions">
          {can(project, 'ingestKey:delete') && !confirming && (
            <button className="btn btn--sm btn--danger" type="button" onClick={() => setConfirming(true)}>
              {t('platform.monitoring.revoke')}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="inline-form">
          <span className="list__muted">{t('platform.monitoring.revokeHint')}</span>
          <button className="btn btn--sm" type="button" onClick={() => {
              setError(null);
              setConfirming(false);
            }}>
            {t('platform.users.cancel')}
          </button>
          <button
            className="btn btn--sm btn--danger-solid"
            type="button"
            disabled={revoke.isPending}
            onClick={() => {
              setError(null);
              revoke.mutate();
            }}
          >
            {t('platform.monitoring.revokeConfirm', { name: ingestKey.name })}
          </button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
