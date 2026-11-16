import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AlertRequest, AlertTarget } from 'fossflow';
import { api } from './api';

export type AlertKind = 'failing' | 'slow' | 'silent';
export const ALERT_KINDS: AlertKind[] = ['failing', 'slow', 'silent'];

export interface AlertRuleView {
  id: string;
  name: string;
  kind: AlertKind;
  target: AlertTarget;
  threshold: number | null;
  windowMinutes: number;
  minCalls: number;
  channelIds: string[];
  enabled: boolean;
  state: 'ok' | 'firing' | 'waiting';
  activeSince: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One attempt to tell a channel about an alert; only a status or a fixed error category, never a body. */
export interface DeliveryRecord {
  at: string;
  state: 'firing' | 'reminder' | 'resolved';
  channelId: string;
  channelName: string | null;
  ok: boolean;
  status: number | null;
  error: string | null;
  attempts: number;
}

export interface AlertEventView {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: AlertKind;
  target: AlertTarget;
  startedAt: string;
  resolvedAt: string | null;
  value: number | null;
  deliveries: DeliveryRecord[];
}

export interface AlertRuleInput {
  name: string;
  kind: AlertKind;
  target: AlertTarget;
  threshold: number | null;
  windowMinutes: number;
  minCalls: number;
  channelIds: string[];
  enabled: boolean;
}

/** Ranges the server enforces; the form checks the same ones before sending. */
export const THRESHOLD_RANGE = { failing: [0.1, 100], slow: [1, 600000] } as const;
export const WINDOW_RANGE = { failing: [1, 60], slow: [1, 60], silent: [5, 2880] } as const;
export const MIN_CALLS_RANGE = [1, 100000] as const;
export const DEFAULT_MIN_CALLS = 10;
export const MAX_CHANNELS = 10;

const REFETCH_MS = 30_000;
const HISTORY_PAGE = 20;

export const alertRulesKey = (projectId: string) => ['alert-rules', projectId] as const;
/** Matches the active and the resolved lists. */
export const alertEventsPrefix = (projectId: string) => ['alert-events', projectId] as const;
export const alertEventsKey = (projectId: string, state: 'active' | 'resolved') =>
  ['alert-events', projectId, state] as const;

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function useAlertRules(projectId: string) {
  return useQuery({
    queryKey: alertRulesKey(projectId),
    queryFn: () => api<AlertRuleView[]>(`${projectPath(projectId)}/alert-rules`),
    refetchInterval: REFETCH_MS
  });
}

export function useActiveAlerts(projectId: string) {
  return useQuery({
    queryKey: alertEventsKey(projectId, 'active'),
    queryFn: () => api<AlertEventView[]>(`${projectPath(projectId)}/alerts?state=active`),
    refetchInterval: REFETCH_MS
  });
}

/** Resolved events, newest first; the cursor is the id of the last one loaded. */
export function useAlertHistory(projectId: string) {
  return useInfiniteQuery({
    queryKey: alertEventsKey(projectId, 'resolved'),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ state: 'resolved', limit: String(HISTORY_PAGE) });
      if (pageParam) query.set('before', pageParam);
      return api<AlertEventView[]>(`${projectPath(projectId)}/alerts?${query.toString()}`);
    },
    getNextPageParam: (lastPage) =>
      lastPage.length === HISTORY_PAGE ? lastPage[lastPage.length - 1]?.id : undefined
  });
}

/** Creates a rule, or saves over the rule `id`. */
export function saveAlertRule(projectId: string, input: AlertRuleInput, id?: string): Promise<AlertRuleView> {
  return id
    ? api<AlertRuleView>(`/api/alert-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })
    : api<AlertRuleView>(`${projectPath(projectId)}/alert-rules`, { method: 'POST', body: input });
}

export function deleteAlertRule(id: string): Promise<null> {
  return api<null>(`/api/alert-rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function setAlertRuleEnabled(id: string, enabled: boolean): Promise<AlertRuleView> {
  return api<AlertRuleView>(`/api/alert-rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } });
}

/** What the form starts from when a card's "Alert me when…" opened it. */
export type AlertPrefill =
  | { type: 'arrow'; from: string[]; to: string[]; name: string }
  | { type: 'box'; identities: string[]; name: string };

// eslint-disable-next-line no-control-regex
const IDENTITY = /^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$/;
const MAX_IDENTITY = 300;
const MAX_NAME = 100;
const MAX_PREFILL_IDENTITIES = 50;

/** Same rule as the server and the lib: service:, host: or db:, an optional leading *. */
export const isAlertIdentity = (value: string) => value.length <= MAX_IDENTITY && IDENTITY.test(value);
const identities = (values: string[]) => Array.from(new Set(values.filter(isAlertIdentity))).slice(0, MAX_PREFILL_IDENTITIES);

/** The query string the editor opens the rule form with. */
export function alertPrefillQuery(request: AlertRequest): string {
  const query = new URLSearchParams({ type: request.type });
  if (request.type === 'arrow') {
    for (const from of request.from) query.append('from', from);
    for (const to of request.to) query.append('to', to);
  } else {
    for (const identity of request.identities) query.append('identity', identity);
  }
  query.set('name', request.name);
  return query.toString();
}

/** Query params are user-controlled: anything malformed is dropped, and no usable target means no prefill. */
export function parseAlertPrefill(params: URLSearchParams): AlertPrefill | null {
  const name = (params.get('name') ?? '').slice(0, MAX_NAME);
  const type = params.get('type');
  if (type === 'arrow') {
    const from = identities(params.getAll('from'));
    const to = identities(params.getAll('to'));
    return from.length && to.length ? { type, from, to, name } : null;
  }
  if (type === 'box') {
    const boxIdentities = identities(params.getAll('identity'));
    return boxIdentities.length ? { type, identities: boxIdentities, name } : null;
  }
  return null;
}

/** Display text for a target, e.g. `service:orders → db:main`. */
export function describeTarget(target: AlertTarget): string {
  return target.type === 'arrow' ? `${target.from} → ${target.to}` : target.identity;
}
