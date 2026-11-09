import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import type { LandscapeSummary } from '../landscapes';
import { type ProjectSummary, useProjects } from '../projects';
import { FormError } from './AuthCard';

interface LandscapeListProps {
  landscapes: LandscapeSummary[];
  /** Overview lists show which project each landscape is in. */
  showProject?: boolean;
}

/** Landscapes with open, rename, move and delete, each only when allowed. */
export function LandscapeList({ landscapes, showProject = false }: LandscapeListProps) {
  const { t, i18n } = useTranslation('app');
  const projects = useProjects();
  const scopesOf = (projectId: string) =>
    projects.data?.find((project) => project.id === projectId)?.scopes ?? [];
  const date = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="list" aria-label={t('platform.projects.landscapes')}>
      {landscapes.map((landscape) => (
        <LandscapeRow
          key={landscape.id}
          landscape={landscape}
          scopes={scopesOf(landscape.projectId)}
          moveTargets={(projects.data ?? []).filter(
            (project) =>
              project.id !== landscape.projectId && project.scopes.includes('landscape:create')
          )}
          meta={[
            showProject
              ? landscape.projectType === 'personal'
                ? t('platform.nav.personal')
                : landscape.projectName
              : null,
            landscape.updatedByName
              ? t('platform.landscapes.updatedBy', {
                  name: landscape.updatedByName,
                  date: date(landscape.updatedAt)
                })
              : t('platform.landscapes.updated', { date: date(landscape.updatedAt) })
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      ))}
    </section>
  );
}

type Mode = 'idle' | 'rename' | 'move' | 'delete';

function LandscapeRow({
  landscape,
  scopes,
  moveTargets,
  meta
}: {
  landscape: LandscapeSummary;
  scopes: string[];
  moveTargets: ProjectSummary[];
  meta: string;
}) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState(landscape.name);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const url = `/api/landscapes/${landscape.id}`;

  const run = useMutation({
    mutationFn: async (action: Exclude<Mode, 'idle'>) => {
      if (action === 'rename') await api(url, { method: 'PATCH', body: { name } });
      if (action === 'move') await api(`${url}/move`, { method: 'POST', body: { projectId: target } });
      if (action === 'delete') await api(url, { method: 'DELETE' });
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      setMode('idle');
      await queryClient.invalidateQueries({ queryKey: ['landscapes'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'))
  });

  const canMove = scopes.includes('landscape:move') && moveTargets.length > 0;

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          {mode === 'rename' ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                run.mutate('rename');
              }}
            >
              <input
                className="field__input"
                aria-label={t('platform.landscapes.name')}
                value={name}
                maxLength={200}
                required
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              <button className="btn btn--primary" type="submit" disabled={run.isPending}>
                {t('platform.projects.save')}
              </button>
              <button className="btn" type="button" onClick={() => setMode('idle')}>
                {t('platform.users.cancel')}
              </button>
            </form>
          ) : (
            <>
              <Link className="list__link" to={`/landscapes/${landscape.id}`}>
                {landscape.name}
              </Link>
              <span className="list__meta">{meta}</span>
            </>
          )}
        </div>
        {mode === 'idle' && (
          <div className="list__actions list__actions--wrap">
            {scopes.includes('landscape:update') && (
              <button className="btn btn--sm" type="button" onClick={() => setMode('rename')}>
                {t('platform.landscapes.rename')}
              </button>
            )}
            {canMove && (
              <button className="btn btn--sm" type="button" onClick={() => setMode('move')}>
                {t('platform.landscapes.move')}
              </button>
            )}
            {scopes.includes('landscape:delete') && (
              <button className="btn btn--sm btn--danger" type="button" onClick={() => setMode('delete')}>
                {t('platform.landscapes.delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {mode === 'move' && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (target) run.mutate('move');
          }}
        >
          <select
            className="field__input"
            aria-label={t('platform.landscapes.moveTo')}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">{t('platform.landscapes.moveTo')}</option>
            {moveTargets.map((project) => (
              <option key={project.id} value={project.id}>
                {project.type === 'personal' ? t('platform.nav.personal') : project.name}
              </option>
            ))}
          </select>
          <button className="btn btn--primary" type="submit" disabled={!target || run.isPending}>
            {t('platform.landscapes.move')}
          </button>
          <button className="btn" type="button" onClick={() => setMode('idle')}>
            {t('platform.users.cancel')}
          </button>
        </form>
      )}

      {mode === 'delete' && (
        <div className="inline-form">
          <span className="list__meta">{t('platform.landscapes.deleteHint')}</span>
          <button className="btn" type="button" onClick={() => setMode('idle')}>
            {t('platform.users.cancel')}
          </button>
          <button
            className="btn btn--danger-solid"
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate('delete')}
          >
            {t('platform.landscapes.deleteConfirm', { name: landscape.name })}
          </button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
