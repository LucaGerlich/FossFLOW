import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIngestKeys } from '../monitoring';
import { can, type ProjectDetail } from '../projects';
import { ConnectService } from './ConnectService';
import { IngestKeyRow } from './IngestKeyRow';

/** A project's Monitoring tab: the services that send it traffic, one key each. */
export function ProjectMonitoring({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const keys = useIngestKeys(project.id);
  const [connecting, setConnecting] = useState(false);

  return (
    <>
      <div className="section-head">
        <h2 className="section-head__title">{t('platform.monitoring.services')}</h2>
        <p className="section-head__hint">{t('platform.monitoring.servicesHint')}</p>
      </div>

      {can(project, 'ingestKey:create') && !connecting && (
        <div className="tab-toolbar">
          <button className="btn btn--primary" type="button" onClick={() => setConnecting(true)}>
            {t('platform.monitoring.connect')}
          </button>
        </div>
      )}

      {connecting && <ConnectService projectId={project.id} onClose={() => setConnecting(false)} />}

      {keys.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : keys.isError ? (
        <p className="form-error" role="alert">
          {t('platform.errors.generic')}
        </p>
      ) : keys.data.length ? (
        <section className="list" aria-label={t('platform.monitoring.services')}>
          {keys.data.map((ingestKey) => (
            <IngestKeyRow key={ingestKey.id} project={project} ingestKey={ingestKey} />
          ))}
        </section>
      ) : (
        !connecting && (
          <div className="empty-state">
            <p className="empty-state__title">{t('platform.monitoring.empty')}</p>
            <p className="empty-state__hint">{t('platform.monitoring.emptyHint')}</p>
          </div>
        )
      )}
    </>
  );
}
