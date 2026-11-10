import { useTranslation } from 'react-i18next';
import { useProjectLandscapes } from '../landscapes';
import { can, type ProjectDetail } from '../projects';
import { LandscapeList } from './LandscapeList';
import { NewLandscape } from './NewLandscape';

/** A project's Landscapes tab. */
export function ProjectLandscapes({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const landscapes = useProjectLandscapes(project.id);

  return (
    <>
      {can(project, 'landscape:create') && (
        <div className="tab-toolbar">
          <NewLandscape projectId={project.id} />
        </div>
      )}
      {landscapes.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : landscapes.data?.length ? (
        <LandscapeList landscapes={landscapes.data} />
      ) : (
        <div className="empty-state">
          <p className="empty-state__title">{t('platform.home.empty')}</p>
          <p className="empty-state__hint">{t('platform.projects.landscapesHint')}</p>
        </div>
      )}
    </>
  );
}
