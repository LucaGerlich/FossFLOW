import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { credentialsKey, type SourceSummary, sourcesKey, useCredentials } from '../credentials';
import type { LandscapeDetail } from '../landscapes';
import { useSubmit } from '../useSubmit';
import { FormError } from './AuthCard';

interface LiveSourcesProps {
  landscape: LandscapeDetail;
  attached: SourceSummary[];
}

/** "Live data" menu in the editor bar: which of the project's credentials this landscape shows. */
export function LiveSources({ landscape, attached }: LiveSourcesProps) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const credentials = useCredentials(landscape.projectId, open);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const onToggle = () => {
    const isOpen = menu.current?.open ?? false;
    setOpen(isOpen);
    if (isOpen) setPicked(new Set(attached.map((source) => source.id)));
  };

  const save = useSubmit(async () => {
    await api(`/api/landscapes/${landscape.id}/sources`, {
      method: 'PUT',
      body: { credentialIds: Array.from(picked) }
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sourcesKey(landscape.id) }),
      queryClient.invalidateQueries({ queryKey: credentialsKey(landscape.projectId) })
    ]);
    if (menu.current) menu.current.open = false;
  });

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <details className="sources-menu" ref={menu} onToggle={onToggle}>
      <summary className="btn btn--sm">
        {attached.length > 0
          ? t('platform.sources.buttonCount', { count: attached.length })
          : t('platform.sources.button')}
      </summary>
      <form className="sources-menu__panel" onSubmit={save.onSubmit}>
        <p className="panel__hint">{t('platform.sources.hint')}</p>
        {credentials.isPending ? (
          <p className="page-loading">{t('platform.loading')}</p>
        ) : credentials.data?.length ? (
          <div className="sources-menu__list">
            {credentials.data.map((credential) => (
              <label className="sources-menu__option" key={credential.id}>
                <input
                  type="checkbox"
                  checked={picked.has(credential.id)}
                  onChange={(event) => toggle(credential.id, event.target.checked)}
                />
                <span>{credential.name}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="list__muted">{t('platform.sources.none')}</p>
        )}
        <FormError message={save.error} />
        <div className="panel__actions">
          <Link className="link-button" to={`/projects/${landscape.projectId}/credentials`}>
            {t('platform.sources.manage')}
          </Link>
          <button className="btn btn--sm btn--primary" type="submit" disabled={save.busy || !credentials.data}>
            {t('platform.projects.save')}
          </button>
        </div>
      </form>
    </details>
  );
}
