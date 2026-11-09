import { useTranslation } from 'react-i18next';
import type { LiveData } from '../services/liveService';

interface LiveIndicatorProps {
  live: LiveData;
}

/** Toolbar pill showing whether live data is flowing. Hidden when live is off. */
export function LiveIndicator({ live }: LiveIndicatorProps) {
  const { t } = useTranslation('app');
  if (live.connection === 'off') return null;

  if (live.connection !== 'ok' || !live.snapshot) {
    return (
      <span className="badge badge--warning" title={live.error ?? undefined}>
        <span className="badge__dot" />
        {t('live.unavailable')}
      </span>
    );
  }

  const source = live.snapshot.sources[0]?.name ?? 'Live';
  const servers = live.snapshot.systems.length;
  // Connected but empty almost always means the source shares nothing with
  // this user, so say how to fix it. ponytail: hint names Beszel, the only source.
  const empty = servers === 0;

  return (
    <span
      className={empty ? 'badge badge--warning' : 'badge'}
      title={empty ? t('live.noServersHint') : undefined}
    >
      <span className="badge__dot" />
      {`${t('live.label')} · ${source} · ${
        empty ? t('live.noServers') : t('live.servers', { count: servers })
      }`}
    </span>
  );
}
