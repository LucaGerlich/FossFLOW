import { useTranslation } from 'react-i18next';
import type { LiveData } from '../services/liveService';

interface LiveIndicatorProps {
  live: LiveData;
}

/** Toolbar pill showing whether live data is flowing. Hidden when live is off. */
export function LiveIndicator({ live }: LiveIndicatorProps) {
  const { t } = useTranslation('app');
  if (live.connection === 'off') return null;

  const ok = live.connection === 'ok';
  const source = live.snapshot?.sources[0]?.name ?? 'Live';

  return (
    <span
      className={ok ? 'badge' : 'badge badge--warning'}
      title={live.error ?? undefined}
    >
      <span className="badge__dot" />
      {ok ? `${t('live.label')} · ${source}` : t('live.unavailable')}
    </span>
  );
}
