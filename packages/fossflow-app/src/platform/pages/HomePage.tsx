import { useTranslation } from 'react-i18next';
import { LandscapeList } from '../components/LandscapeList';
import { NewLandscape } from '../components/NewLandscape';
import { useOverview } from '../landscapes';
import { useProjects } from '../projects';

/** Overview: landscapes across all your projects; new ones start in Personal. */
export function HomePage() {
  const { t } = useTranslation('app');
  const overview = useOverview();
  const projects = useProjects();
  const personal = projects.data?.find(
    (project) => project.type === 'personal' && project.role === 'project:personalOwner'
  );

  return (
    <>
      <header className="page__header">
        <h1 className="page__title">{t('platform.home.title')}</h1>
        {personal && <NewLandscape projectId={personal.id} />}
      </header>
      {overview.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : overview.data?.length ? (
        <LandscapeList landscapes={overview.data} showProject />
      ) : (
        <div className="empty-state">
          <p className="empty-state__title">{t('platform.home.empty')}</p>
          <p className="empty-state__hint">{t('platform.home.emptyHint')}</p>
        </div>
      )}
    </>
  );
}
