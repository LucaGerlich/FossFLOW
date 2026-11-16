import { useTranslation } from 'react-i18next';
import { type AlertEventView, type DeliveryRecord, describeTarget } from '../alerts';

/** The newest attempt per channel; older attempts of the same alert no longer matter. */
function latestPerChannel(deliveries: DeliveryRecord[]): DeliveryRecord[] {
  const latest = new Map<string, DeliveryRecord>();
  for (const delivery of deliveries) latest.set(delivery.channelId, delivery);
  return Array.from(latest.values());
}

/** One alert, open or resolved: rule, target, when, how bad, and any delivery that failed. */
export function AlertEventRow({ event }: { event: AlertEventView }) {
  const { t, i18n } = useTranslation('app');
  const format = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const value =
    event.value === null
      ? null
      : event.kind === 'failing'
        ? t('platform.alerts.valueFailing', { value: Math.round(event.value * 10) / 10 })
        : event.kind === 'slow'
          ? t('platform.alerts.valueSlow', { value: Math.round(event.value) })
          : t('platform.alerts.valueSilent', { value: Math.round(event.value) });

  const when = event.resolvedAt
    ? t('platform.alerts.fromTo', { start: format(event.startedAt), end: format(event.resolvedAt) })
    : t('platform.alerts.since', { date: format(event.startedAt) });

  const problems = latestPerChannel(event.deliveries)
    .filter((delivery) => !delivery.ok)
    .map((delivery) =>
      t('platform.alerts.notDelivered', {
        channel: delivery.channelName ?? t('platform.alerts.deletedChannel'),
        reason: delivery.status ?? delivery.error ?? t('platform.alerts.unknownReason')
      })
    );

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          <span className="list__title">
            {event.ruleName}{' '}
            <span className={`badge badge--mono alert-kind${event.resolvedAt === null ? ` alert-kind--${event.kind}` : ''}`}>
              {t(`platform.alerts.kind.${event.kind}`)}
            </span>
          </span>
          <span className="list__meta">{[describeTarget(event.target), when, value].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      {problems.length > 0 && (
        <p className="note note--warning alert-problems">
          {problems.map((problem) => (
            <span key={problem}>{problem}</span>
          ))}
        </p>
      )}
    </div>
  );
}
