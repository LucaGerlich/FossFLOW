import { useTranslation } from 'react-i18next';
import type { TrafficStatus } from '../platform/traffic';

interface TrafficIndicatorProps {
  status: TrafficStatus;
}

/** Toolbar pill showing whether live traffic is streaming. Hidden when there is none. */
export function TrafficIndicator({ status }: TrafficIndicatorProps) {
  const { t } = useTranslation('app');
  if (status === 'off') return null;

  return (
    <span className={status === 'live' ? 'badge' : 'badge badge--muted'}>
      <span className="badge__dot" />
      {status === 'live' ? t('live.trafficLive') : t('live.trafficConnecting')}
    </span>
  );
}
