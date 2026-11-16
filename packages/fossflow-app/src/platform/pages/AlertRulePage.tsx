import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { parseAlertPrefill, useAlertRules } from '../alerts';
import { AlertRuleForm } from '../components/AlertRuleForm';
import { can, type ProjectDetail } from '../projects';

/** Only an in-app path may be returned to; anything else falls back to Monitoring. */
function safeReturnTo(state: unknown, fallback: string): string {
  const value = (state as { returnTo?: unknown } | null)?.returnTo;
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/** A new rule (optionally prefilled from a card) or an edit of `:ruleId`. */
export function AlertRulePage({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const { ruleId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const rules = useAlertRules(project.id);
  const monitoring = `/projects/${project.id}/monitoring`;
  const returnTo = safeReturnTo(location.state, monitoring);

  const back = (
    <Link className="link-button" to={returnTo}>
      {t('platform.alerts.back')}
    </Link>
  );

  if (!ruleId) {
    if (!can(project, 'alertRule:create')) return <NotAllowed back={back} />;
    // Keyed on the query so a different card's prefill starts a fresh form.
    return (
      <AlertRuleForm key={params.toString()} project={project} prefill={parseAlertPrefill(params)} returnTo={returnTo} />
    );
  }

  if (!can(project, 'alertRule:update')) return <NotAllowed back={back} />;
  if (rules.isPending) return <p className="page-loading">{t('platform.loading')}</p>;
  const existing = rules.data?.find((rule) => rule.id === ruleId);
  if (!existing) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">{t('platform.alerts.notFound')}</p>
        {back}
      </div>
    );
  }
  return <AlertRuleForm key={existing.id} project={project} existing={existing} returnTo={returnTo} />;
}

function NotAllowed({ back }: { back: React.ReactNode }) {
  const { t } = useTranslation('app');
  return (
    <div className="empty-state">
      <p className="empty-state__title">{t('platform.alerts.notAllowed')}</p>
      {back}
    </div>
  );
}
