import { useQueryClient } from '@tanstack/react-query';
import { type InitialData, Isoflow, type Model } from 'fossflow';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { coreIcons, defaultColors, editorLocale, isImportedIcon } from '../../editorDefaults';
import { LiveIndicator } from '../../components/LiveIndicator';
import { TrafficIndicator } from '../../components/TrafficIndicator';
import { useIconPackManager } from '../../services/iconPackManager';
import { useLiveData } from '../../services/liveService';
import { LiveSources } from '../components/LiveSources';
import { useSources } from '../credentials';
import { type LandscapeDetail, landscapeKey, type StoredModel, useLandscape } from '../landscapes';
import { useTrafficFeed } from '../traffic';
import { type SaveState, useAutosave } from '../useAutosave';

/** Full-screen editor for one landscape, saving to the server as you work. */
export function LandscapeEditor() {
  const { t } = useTranslation('app');
  const { landscapeId = '' } = useParams();
  const queryClient = useQueryClient();
  const landscape = useLandscape(landscapeId);
  const [session, setSession] = useState(0);

  if (landscape.isPending) return <p className="page-loading">{t('platform.loading')}</p>;
  if (landscape.isError) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <p className="note note--warning">{t('platform.landscapes.notFound')}</p>
          <Link className="link-button" to="/">
            {t('platform.landscapes.back')}
          </Link>
        </div>
      </main>
    );
  }

  const reload = async () => {
    await queryClient.refetchQueries({ queryKey: landscapeKey(landscapeId) });
    setSession((value) => value + 1);
  };

  return <EditorSession key={`${landscapeId}-${session}`} landscape={landscape.data} onReload={reload} />;
}

function EditorSession({
  landscape,
  onReload
}: {
  landscape: LandscapeDetail;
  onReload: () => void;
}) {
  const { t, i18n } = useTranslation('app');
  const canEdit = landscape.scopes.includes('landscape:update');
  const canPickSources = canEdit && landscape.scopes.includes('credential:use');
  const sources = useSources(landscape.id);
  const sourceIds = (sources.data ?? []).map((source) => source.id).join(',');
  const live = useLiveData(sourceIds ? landscape.id : null, sourceIds);
  const traffic = useTrafficFeed(landscape.id);
  const iconPacks = useIconPackManager(coreIcons);
  const autosave = useAutosave(landscape.id, landscape);
  const [packsReady, setPacksReady] = useState(false);

  // Like the local editor: the editor's own model is fed back in, so a late
  // icon-pack load never resets edits that haven't been saved yet.
  const [model, setModel] = useState<InitialData>(() => {
    // The server checks the outline; the editor validates the details on load.
    const stored = landscape.model as unknown as Model;
    return {
      ...stored,
      title: stored.title || landscape.name,
      colors: stored.colors.length ? stored.colors : defaultColors,
      icons: [...coreIcons, ...stored.icons.filter(isImportedIcon)],
      fitToView: true
    };
  });

  useEffect(() => {
    void iconPacks.loadPacksForDiagram(landscape.model.items).finally(() => setPacksReady(true));
    // Runs once per opened landscape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setModel((current) => ({
      ...current,
      icons: [...iconPacks.loadedIcons, ...current.icons.filter(isImportedIcon)]
    }));
  }, [iconPacks.loadedIcons]);

  // Until someone clicks or types, model updates are the editor tidying the
  // model as it loads: adopt them as the baseline instead of saving.
  const touched = useRef(false);
  useEffect(() => {
    const touch = () => {
      touched.current = true;
    };
    window.addEventListener('pointerdown', touch, { capture: true, once: true });
    window.addEventListener('keydown', touch, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', touch, { capture: true });
      window.removeEventListener('keydown', touch, { capture: true });
    };
  }, []);

  const { schedule, adopt } = autosave;
  const onModelUpdated = useCallback(
    (updated: Model) => {
      setModel((current) => ({ ...current, ...updated }));
      if (!canEdit) return;
      if (touched.current) schedule(updated as StoredModel);
      else adopt(updated as StoredModel);
    },
    [canEdit, schedule, adopt]
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...model, fitToView: undefined }, null, 2)], {
      type: 'application/json'
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${landscape.name.replace(/[^\w.-]+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const projectLabel =
    landscape.projectType === 'personal' ? t('platform.nav.personal') : landscape.projectName;

  return (
    <div className="editor-page">
      <header className="editor-bar">
        <div className="editor-bar__start">
          <Link className="editor-bar__back" to={`/projects/${landscape.projectId}`}>
            ← {projectLabel}
          </Link>
          <span className="editor-bar__sep" aria-hidden="true">/</span>
          <h1 className="editor-bar__title">{landscape.name}</h1>
          {canEdit ? (
            <SaveStatus state={autosave.state} onRetry={autosave.retry} />
          ) : (
            <span className="badge badge--mono">{t('platform.landscapes.readOnly')}</span>
          )}
        </div>
        <div className="editor-bar__end">
          <LiveIndicator live={live} />
          <TrafficIndicator status={traffic.status} />
          {canPickSources && <LiveSources landscape={landscape} attached={sources.data ?? []} />}
          <button className="btn btn--sm" type="button" onClick={exportJson}>
            {t('platform.landscapes.export')}
          </button>
        </div>
      </header>

      {autosave.conflict && (
        <div className="editor-banner" role="alert">
          <span>
            {t('platform.landscapes.conflict', {
              name: autosave.conflict.updatedByName ?? t('platform.landscapes.someone')
            })}
          </span>
          <button className="btn btn--sm" type="button" onClick={onReload}>
            {t('platform.landscapes.reload')}
          </button>
          <button className="btn btn--sm btn--primary" type="button" onClick={autosave.overwrite}>
            {t('platform.landscapes.overwrite')}
          </button>
        </div>
      )}

      <div className="fossflow-container">
        {packsReady ? (
          <Isoflow
            key={i18n.language}
            initialData={model}
            onModelUpdated={onModelUpdated}
            editorMode={canEdit ? 'EDITABLE' : 'EXPLORABLE_READONLY'}
            locale={editorLocale(i18n.language)}
            live={live.snapshot}
            traffic={traffic.feed}
            iconPackManager={{
              lazyLoadingEnabled: iconPacks.lazyLoadingEnabled,
              onToggleLazyLoading: iconPacks.toggleLazyLoading,
              packInfo: Object.values(iconPacks.packInfo),
              enabledPacks: iconPacks.enabledPacks,
              onTogglePack: (packName: string, enabled: boolean) => {
                void iconPacks.togglePack(packName as never, enabled);
              }
            }}
          />
        ) : (
          <p className="page-loading">{t('platform.loading')}</p>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useTranslation('app');
  if (state === 'error') {
    return (
      <span className="save-status save-status--error">
        {t('platform.landscapes.saveFailed')}{' '}
        <button className="link-button link-button--inline" type="button" onClick={onRetry}>
          {t('platform.landscapes.retry')}
        </button>
      </span>
    );
  }
  const label = {
    saved: t('platform.landscapes.saved'),
    pending: t('platform.landscapes.unsaved'),
    saving: t('platform.landscapes.saving'),
    conflict: t('platform.landscapes.notSaved')
  }[state];
  return (
    <span className={`save-status save-status--${state}`} aria-live="polite">
      {label}
    </span>
  );
}
