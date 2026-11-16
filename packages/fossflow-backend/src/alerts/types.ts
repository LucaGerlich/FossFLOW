import type { AlertTarget } from '../connectors/channels/message.js';

/** One attempt to tell a channel about an alert; written by the evaluator. */
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

export type RuleKind = 'failing' | 'slow' | 'silent';

export interface AlertRuleView {
  id: string;
  name: string;
  kind: RuleKind;
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

export interface AlertEventView {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: RuleKind;
  target: AlertTarget;
  startedAt: string;
  resolvedAt: string | null;
  value: number | null;
  deliveries: DeliveryRecord[];
}
