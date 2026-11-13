import { useTranslation } from 'react-i18next';
import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { can, useProject } from '../projects';
import { ProjectCredentials } from '../components/ProjectCredentials';
import { ProjectLandscapes } from '../components/ProjectLandscapes';
import { ProjectMonitoring } from '../components/ProjectMonitoring';
import { ProjectSettings } from './ProjectSettings';

const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab tab--active' : 'tab');

/** A project, n8n-style: its landscapes, credentials, and settings for project admins. */
export function ProjectPage() {
  const { t } = useTranslation('app');
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  // Absolute: inside a splat route, relative links resolve against the full URL.
  const base = `/projects/${projectId}`;

  if (project.isPending) return <p className="page-loading">{t('platform.loading')}</p>;
  if (project.isError) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">{t('platform.projects.notFound')}</p>
      </div>
    );
  }

  const data = project.data;
  const showSettings =
    data.type === 'team' && (can(data, 'project:update') || can(data, 'projectMember:manage'));
  const showCredentials = can(data, 'credential:read');
  const showMonitoring = can(data, 'ingestKey:read');
  const title = data.type === 'personal' ? t('platform.nav.personal') : data.name;

  return (
    <>
      <header className="page__header page__header--tabs">
        <div>
          <h1 className="page__title">{title}</h1>
          {data.type === 'personal' && (
            <p className="page__subtitle">{t('platform.projects.personalHint')}</p>
          )}
        </div>
      </header>
      <nav className="tabs" aria-label={title}>
        <NavLink to={base} end className={tabClass}>
          {t('platform.projects.landscapes')}
        </NavLink>
        {showCredentials && (
          <NavLink to={`${base}/credentials`} className={tabClass}>
            {t('platform.projects.credentials')}
          </NavLink>
        )}
        {showMonitoring && (
          <NavLink to={`${base}/monitoring`} className={tabClass}>
            {t('platform.projects.monitoring')}
          </NavLink>
        )}
        {showSettings && (
          <NavLink to={`${base}/settings`} className={tabClass}>
            {t('platform.projects.settings')}
          </NavLink>
        )}
      </nav>
      <Routes>
        <Route index element={<ProjectLandscapes project={data} />} />
        {showCredentials && (
          <Route path="credentials" element={<ProjectCredentials project={data} />} />
        )}
        {showMonitoring && (
          <Route path="monitoring" element={<ProjectMonitoring key={data.id} project={data} />} />
        )}
        {showSettings && <Route path="settings" element={<ProjectSettings project={data} />} />}
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </>
  );
}
