import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ApiError } from '../api';
import {
  type AlertRuleView,
  alertEventsPrefix,
  alertRulesKey,
  deleteAlertRule,
  describeTarget,
  setAlertRuleEnabled,
  useActiveAlerts,
  useAlertHistory,
  useAlertRules
} from '../alerts';
import { can, type ProjectDetail } from '../projects';
import { FormError } from './AuthCard';
import { AlertEventRow } from './AlertEventRow';

/** The Alerts section of Monitoring: what is firing, the rules, and what fired before. */
export function ProjectAlerts({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const base = `/projects/${project.id}/monitoring/alerts`;
  const rules = useAlertRules(project.id);
  const active = useActiveAlerts(project.id);
  const history = useAlertHistory(project.id);
  const failed = (rules.isError || active.isError) && <p className="form-error" role="alert">{t('platform.errors.generic')}</p>;
  const past = history.data?.pages.flat() ?? [];

  return (
    <section className="alerts" aria-label={t('platform.alerts.title')}>
      <div className="section-head">
        <h2 className="section-head__title">{t('platform.alerts.title')}</h2>
        <p className="section-head__hint">{t('platform.alerts.hint')}</p>
      </div>
      {failed}

      {active.data && active.data.length > 0 && (
        <>
          <h3 className="alerts__heading">{t('platform.alerts.active')}</h3>
          <div className="list">
            {active.data.map((event) => (
              <AlertEventRow key={event.id} event={event} />
            ))}
          </div>
        </>
      )}

      <div className="alerts__heading-row">
        <h3 className="alerts__heading">{t('platform.alerts.rules')}</h3>
        {can(project, 'alertRule:create') && (
          <Link className="btn btn--primary" to={`${base}/new`}>
            {t('platform.alerts.newRule')}
          </Link>
        )}
      </div>
      {rules.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : rules.data?.length ? (
        <div className="list">
          {rules.data.map((rule) => (
            <AlertRuleRow key={rule.id} project={project} rule={rule} editPath={`${base}/${rule.id}`} />
          ))}
        </div>
      ) : (
        !rules.isError && (
          <div className="empty-state">
            <p className="empty-state__title">{t('platform.alerts.empty')}</p>
            <p className="empty-state__hint">{t('platform.alerts.emptyHint')}</p>
          </div>
        )
      )}

      <h3 className="alerts__heading">{t('platform.alerts.history')}</h3>
      {history.isPending ? (
        <p className="page-loading">{t('platform.loading')}</p>
      ) : past.length ? (
        <>
          <div className="list">
            {past.map((event) => (
              <AlertEventRow key={event.id} event={event} />
            ))}
          </div>
          {history.hasNextPage && (
            <div className="tab-toolbar">
              <button
                className="btn"
                type="button"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t('platform.alerts.showMore')}
              </button>
            </div>
          )}
        </>
      ) : (
        !history.isError && <p className="list__muted">{t('platform.alerts.historyEmpty')}</p>
      )}
    </section>
  );
}

function AlertRuleRow({ project, rule, editPath }: { project: ProjectDetail; rule: AlertRuleView; editPath: string }) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: alertRulesKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: alertEventsPrefix(project.id) })
    ]);
  const onError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'));

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setAlertRuleEnabled(rule.id, enabled),
    onSuccess: refresh,
    onError
  });
  const remove = useMutation({
    mutationFn: () => deleteAlertRule(rule.id),
    onSuccess: refresh,
    onError
  });

  const canUpdate = can(project, 'alertRule:update');
  const canDelete = can(project, 'alertRule:delete');

  return (
    <div className="list__row list__row--stacked">
      <div className="list__row-main">
        <div className="list__main">
          <span className="list__title">
            {rule.name}{' '}
            <span className={`badge badge--mono alert-kind alert-kind--${rule.kind}`}>
              {t(`platform.alerts.kind.${rule.kind}`)}
            </span>
          </span>
          <span className="list__meta">
            {[describeTarget(rule.target), t(`platform.alerts.state.${rule.enabled ? rule.state : 'off'}`)].join(' · ')}
          </span>
        </div>
        <div className="list__actions list__actions--wrap">
          {canUpdate && (
            <label className="choice">
              <input
                type="checkbox"
                role="switch"
                checked={rule.enabled}
                disabled={toggle.isPending}
                onChange={(event) => {
                  setError(null);
                  toggle.mutate(event.target.checked);
                }}
              />
              <span>{t('platform.alerts.enabled')}</span>
            </label>
          )}
          {canUpdate && (
            <Link className="btn btn--sm" to={editPath}>
              {t('platform.alerts.edit')}
            </Link>
          )}
          {canDelete && !confirming && (
            <button className="btn btn--sm btn--danger" type="button" onClick={() => setConfirming(true)}>
              {t('platform.alerts.delete')}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="inline-form">
          <span className="list__muted">{t('platform.alerts.deleteHint')}</span>
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(false);
            }}
          >
            {t('platform.users.cancel')}
          </button>
          <button
            className="btn btn--sm btn--danger-solid"
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              setError(null);
              remove.mutate();
            }}
          >
            {t('platform.alerts.deleteConfirm', { name: rule.name })}
          </button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
