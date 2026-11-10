import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../api';
import {
  type ConnectorInfo,
  type CredentialSummary,
  credentialsKey,
  useConnectors,
  useCredential,
  useCredentials
} from '../credentials';
import { can, type ProjectDetail } from '../projects';
import { FormError } from './AuthCard';
import { CredentialForm } from './CredentialForm';

type Editing = { kind: 'new'; connector: ConnectorInfo } | { kind: 'edit'; id: string } | null;

/** A project's Credentials tab: logins for live sources, n8n-style. */
export function ProjectCredentials({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const credentials = useCredentials(project.id);
  const connectors = useConnectors();
  const [editing, setEditing] = useState<Editing>(null);
  const [connectorId, setConnectorId] = useState('');
  const close = () => setEditing(null);

  const picked = connectors.data?.find((connector) => connector.id === connectorId) ?? connectors.data?.[0];

  return (
    <>
      {can(project, 'credential:create') && picked && editing === null && (
        <div className="tab-toolbar">
          <div className="page__actions">
            {(connectors.data?.length ?? 0) > 1 && (
              <select
                className="field__input field__input--compact"
                aria-label={t('platform.credentials.type')}
                value={picked.id}
                onChange={(event) => setConnectorId(event.target.value)}
              >
                {connectors.data?.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => setEditing({ kind: 'new', connector: picked })}
            >
              {t('platform.credentials.add', { connector: picked.name })}
            </button>
          </div>
        </div>
      )}

      {editing?.kind === 'new' && (
        <CredentialForm projectId={project.id} connector={editing.connector} onClose={close} />
      )}
      {editing?.kind === 'edit' && (
        <EditCredential projectId={project.id} id={editing.id} connectors={connectors.data ?? []} onClose={close} />
      )}

      {credentials.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : credentials.data?.length ? (
        <section className="list" aria-label={t('platform.projects.credentials')}>
          {credentials.data.map((credential) => (
            <CredentialRow
              key={credential.id}
              project={project}
              credential={credential}
              connectorName={connectors.data?.find((c) => c.id === credential.type)?.name ?? credential.type}
              onEdit={() => setEditing({ kind: 'edit', id: credential.id })}
            />
          ))}
        </section>
      ) : (
        editing === null && (
          <div className="empty-state">
            <p className="empty-state__title">{t('platform.credentials.empty')}</p>
            <p className="empty-state__hint">{t('platform.credentials.emptyHint')}</p>
          </div>
        )
      )}
    </>
  );
}

function EditCredential({
  projectId,
  id,
  connectors,
  onClose
}: {
  projectId: string;
  id: string;
  connectors: ConnectorInfo[];
  onClose: () => void;
}) {
  const { t } = useTranslation('app');
  const detail = useCredential(id);
  if (detail.isPending) return <p className="page-loading">{t('platform.loading')}</p>;
  const connector = connectors.find((candidate) => candidate.id === detail.data?.type);
  if (detail.isError || !connector) {
    return <FormError message={t('platform.errors.generic')} />;
  }
  return <CredentialForm projectId={projectId} connector={connector} existing={detail.data} onClose={onClose} />;
}

function CredentialRow({
  project,
  credential,
  connectorName,
  onEdit
}: {
  project: ProjectDetail;
  credential: CredentialSummary;
  connectorName: string;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation('app');
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => api(`/api/credentials/${credential.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: credentialsKey(project.id) }),
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'))
  });

  const updated = new Date(credential.updatedAt).toLocaleString(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const meta = [
    connectorName,
    t('platform.credentials.usedBy', { count: credential.usedBy }),
    t('platform.landscapes.updated', { date: updated })
  ].join(' · ');

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          <span className="list__title">{credential.name}</span>
          <span className="list__meta">{meta}</span>
        </div>
        <div className="list__actions">
          {can(project, 'credential:update') && (
            <button className="btn btn--sm" type="button" onClick={onEdit}>
              {t('platform.credentials.editButton')}
            </button>
          )}
          {can(project, 'credential:delete') && !confirming && (
            <button className="btn btn--sm btn--danger" type="button" onClick={() => setConfirming(true)}>
              {t('platform.landscapes.delete')}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="inline-form">
          <span className="list__muted">
            {credential.usedBy > 0
              ? t('platform.credentials.deleteUsed', { count: credential.usedBy })
              : t('platform.credentials.deleteHint')}
          </span>
          <button className="btn btn--sm" type="button" onClick={() => setConfirming(false)}>
            {t('platform.users.cancel')}
          </button>
          <button
            className="btn btn--sm btn--danger-solid"
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('platform.landscapes.deleteConfirm', { name: credential.name })}
          </button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
