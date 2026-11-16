import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  ALERT_KINDS,
  type AlertKind,
  type AlertPrefill,
  type AlertRuleInput,
  type AlertRuleView,
  alertEventsPrefix,
  alertRulesKey,
  DEFAULT_MIN_CALLS,
  isAlertIdentity,
  MAX_CHANNELS,
  MIN_CALLS_RANGE,
  saveAlertRule,
  THRESHOLD_RANGE,
  WINDOW_RANGE
} from '../alerts';
import { useCredentials } from '../credentials';
import type { ProjectDetail } from '../projects';
import { useSubmit } from '../useSubmit';
import { Field, FormError } from './AuthCard';

const KIND_DEFAULTS: Record<AlertKind, { threshold: string; window: string }> = {
  failing: { threshold: '5', window: '5' },
  slow: { threshold: '1000', window: '5' },
  silent: { threshold: '', window: '30' }
};

interface AlertRuleFormProps {
  project: ProjectDetail;
  /** The rule being edited; absent for a new one. */
  existing?: AlertRuleView;
  prefill?: AlertPrefill | null;
  /** Where to go after saving or cancelling. */
  returnTo: string;
}

/** Name, what to watch, when it counts as an alert, and where to tell people. */
export function AlertRuleForm({ project, existing, prefill, returnTo }: AlertRuleFormProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const credentials = useCredentials(project.id);
  const channels = (credentials.data ?? []).filter((credential) => credential.kind === 'channel');

  const [name, setName] = useState(existing?.name ?? prefill?.name ?? '');
  const [kind, setKind] = useState<AlertKind>(existing?.kind ?? 'failing');
  const [targetType, setTargetType] = useState<'arrow' | 'box'>(
    existing?.target.type ?? prefill?.type ?? 'arrow'
  );
  const [from, setFrom] = useState(
    existing?.target.type === 'arrow' ? existing.target.from : prefill?.type === 'arrow' ? (prefill.from[0] ?? '') : ''
  );
  const [to, setTo] = useState(
    existing?.target.type === 'arrow' ? existing.target.to : prefill?.type === 'arrow' ? (prefill.to[0] ?? '') : ''
  );
  const [identity, setIdentity] = useState(
    existing?.target.type === 'box'
      ? existing.target.identity
      : prefill?.type === 'box'
        ? (prefill.identities[0] ?? '')
        : ''
  );
  const [threshold, setThreshold] = useState(
    existing ? (existing.threshold === null ? '' : String(existing.threshold)) : KIND_DEFAULTS.failing.threshold
  );
  const [windowMinutes, setWindowMinutes] = useState(
    existing ? String(existing.windowMinutes) : KIND_DEFAULTS.failing.window
  );
  const [minCalls, setMinCalls] = useState(String(existing?.minCalls ?? DEFAULT_MIN_CALLS));
  const [channelIds, setChannelIds] = useState<string[]>(existing?.channelIds ?? []);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [showProblem, setShowProblem] = useState(false);

  // A prefill only fits the target type it came from.
  const prefilled = !existing && prefill && prefill.type === targetType ? prefill : null;

  const changeKind = (next: AlertKind) => {
    setKind(next);
    setThreshold(KIND_DEFAULTS[next].threshold);
    setWindowMinutes(KIND_DEFAULTS[next].window);
  };

  const buildInput = (): AlertRuleInput | string => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) return t('platform.alerts.errors.name');
    const target =
      targetType === 'arrow'
        ? { type: 'arrow' as const, from: from.trim(), to: to.trim() }
        : { type: 'box' as const, identity: identity.trim() };
    const patterns = target.type === 'arrow' ? [target.from, target.to] : [target.identity];
    if (patterns.some((pattern) => !isAlertIdentity(pattern))) return t('platform.alerts.errors.target');

    const window = Number(windowMinutes);
    const [windowLow, windowHigh] = WINDOW_RANGE[kind];
    if (windowMinutes.trim() === '' || !Number.isInteger(window) || window < windowLow || window > windowHigh) {
      return t('platform.alerts.errors.window', { min: windowLow, max: windowHigh });
    }
    let limit: number | null = null;
    if (kind !== 'silent') {
      const [low, high] = THRESHOLD_RANGE[kind];
      limit = Number(threshold);
      if (threshold.trim() === '' || !Number.isFinite(limit) || limit < low || limit > high) {
        return t('platform.alerts.errors.threshold', { min: low, max: high });
      }
    }
    const calls = Number(minCalls);
    if (
      kind !== 'silent' &&
      (minCalls.trim() === '' || !Number.isInteger(calls) || calls < MIN_CALLS_RANGE[0] || calls > MIN_CALLS_RANGE[1])
    ) {
      return t('platform.alerts.errors.minCalls', { min: MIN_CALLS_RANGE[0], max: MIN_CALLS_RANGE[1] });
    }
    // Only a loaded list can say a channel is gone; until then every selection is kept.
    const known = credentials.isSuccess
      ? channelIds.filter((id) => channels.some((channel) => channel.id === id))
      : channelIds;
    if (known.length > MAX_CHANNELS) return t('platform.alerts.errors.channels', { max: MAX_CHANNELS });
    return {
      name: trimmed,
      kind,
      target,
      threshold: limit,
      windowMinutes: window,
      minCalls: kind === 'silent' ? (existing?.minCalls ?? DEFAULT_MIN_CALLS) : calls,
      channelIds: known,
      enabled
    };
  };

  const problem = (() => {
    const result = buildInput();
    return typeof result === 'string' ? result : null;
  })();

  const save = useSubmit(async () => {
    const input = buildInput();
    if (typeof input === 'string') {
      setShowProblem(true);
      return;
    }
    await saveAlertRule(project.id, input, existing?.id);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: alertRulesKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: alertEventsPrefix(project.id) })
    ]);
    navigate(returnTo, { replace: true });
  });

  const toggleChannel = (id: string, checked: boolean) =>
    setChannelIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));

  return (
    <form className="panel alert-rule-form" onSubmit={save.onSubmit}>
      <h2 className="panel__title">{existing ? t('platform.alerts.editTitle') : t('platform.alerts.newTitle')}</h2>

      <Field label={t('platform.alerts.form.name')} name="alertName" value={name} onChange={setName} autoFocus />

      <fieldset className="choice-group">
        <legend className="field__label">{t('platform.alerts.form.kind')}</legend>
        {ALERT_KINDS.map((option) => (
          <label className="choice" key={option}>
            <input type="radio" name="kind" checked={kind === option} onChange={() => changeKind(option)} />
            <span>
              {t(`platform.alerts.kind.${option}`)}
              <span className="field__hint"> {t(`platform.alerts.form.kindHint.${option}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="choice-group">
        <legend className="field__label">{t('platform.alerts.form.target')}</legend>
        {!existing && !prefill && (
          <div className="choice-row">
            {(['arrow', 'box'] as const).map((option) => (
              <label className="choice" key={option}>
                <input
                  type="radio"
                  name="targetType"
                  checked={targetType === option}
                  onChange={() => setTargetType(option)}
                />
                <span>{t(`platform.alerts.form.targetType.${option}`)}</span>
              </label>
            ))}
          </div>
        )}
        {targetType === 'arrow' ? (
          <>
            <TargetInput
              label={t('platform.alerts.form.from')}
              name="from"
              value={from}
              onChange={setFrom}
              options={prefilled?.type === 'arrow' ? prefilled.from : null}
            />
            <TargetInput
              label={t('platform.alerts.form.to')}
              name="to"
              value={to}
              onChange={setTo}
              options={prefilled?.type === 'arrow' ? prefilled.to : null}
            />
          </>
        ) : (
          <TargetInput
            label={t('platform.alerts.form.identity')}
            name="identity"
            value={identity}
            onChange={setIdentity}
            options={prefilled?.type === 'box' ? prefilled.identities : null}
          />
        )}
        <span className="field__hint">{t('platform.alerts.form.targetHint')}</span>
      </fieldset>

      {kind !== 'silent' && (
        <Field
          label={t(`platform.alerts.form.threshold.${kind}`)}
          name="threshold"
          value={threshold}
          onChange={setThreshold}
        />
      )}
      <Field
        label={t(kind === 'silent' ? 'platform.alerts.form.windowSilent' : 'platform.alerts.form.window')}
        name="windowMinutes"
        value={windowMinutes}
        onChange={setWindowMinutes}
        hint={t('platform.alerts.form.windowRange', { min: WINDOW_RANGE[kind][0], max: WINDOW_RANGE[kind][1] })}
      />
      {kind !== 'silent' && (
        <Field
          label={t('platform.alerts.form.minCalls')}
          name="minCalls"
          value={minCalls}
          onChange={setMinCalls}
          hint={t('platform.alerts.form.minCallsHint')}
        />
      )}

      <fieldset className="choice-group">
        <legend className="field__label">{t('platform.alerts.form.channels')}</legend>
        {credentials.isPending ? (
          <span className="field__hint">{t('platform.loading')}</span>
        ) : credentials.isError ? null : channels.length ? (
          channels.map((channel) => (
            <label className="choice" key={channel.id}>
              <input
                type="checkbox"
                checked={channelIds.includes(channel.id)}
                onChange={(event) => toggleChannel(channel.id, event.target.checked)}
              />
              <span>{channel.name}</span>
            </label>
          ))
        ) : (
          <span className="field__hint">
            {t('platform.alerts.form.noChannels')}{' '}
            <Link to={`/projects/${project.id}/credentials`}>{t('platform.alerts.form.addChannel')}</Link>
          </span>
        )}
      </fieldset>

      <label className="choice">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>{t('platform.alerts.form.enabled')}</span>
      </label>

      <FormError message={credentials.isError ? t('platform.errors.generic') : null} />
      <FormError message={showProblem ? problem : null} />
      <FormError message={save.error} />
      <div className="panel__actions">
        <button className="btn" type="button" onClick={() => navigate(returnTo, { replace: true })}>
          {t('platform.users.cancel')}
        </button>
        <button className="btn btn--primary" type="submit" disabled={save.busy || !credentials.isSuccess}>
          {existing ? t('platform.alerts.form.save') : t('platform.alerts.form.create')}
        </button>
      </div>
    </form>
  );
}

/** A select when the card offered the candidates, otherwise a text field. */
function TargetInput({
  label,
  name,
  value,
  onChange,
  options
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | null;
}) {
  if (!options) return <Field label={label} name={name} value={value} onChange={onChange} />;
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="field__input" name={name} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
