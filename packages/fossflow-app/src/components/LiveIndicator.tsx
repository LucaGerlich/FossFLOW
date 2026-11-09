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
      title={live.error ?? undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${ok ? '#ebebeb' : '#ffefcf'}`,
        background: ok ? '#fafafa' : '#ffefcf',
        color: ok ? '#4d4d4d' : '#ab570a',
        fontSize: 12,
        whiteSpace: 'nowrap'
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: ok ? '#29bc9b' : '#f5a623'
        }}
      />
      {ok ? `${t('live.label')} · ${source}` : t('live.unavailable')}
    </span>
  );
}
