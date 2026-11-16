import type { z } from 'zod';
import type { SourceClient } from '../live/hub.js';
import type { AlertMessage } from './channels/message.js';
import type { ChannelDeps, SendResult } from './channels/types.js';

/** A source feeds live data into landscapes; a channel receives alerts. */
export type ConnectorKind = 'source' | 'channel';

/** One input on a credential form; the app builds the form from these. */
export interface ConnectorField {
  name: string;
  label: string;
  type: 'url' | 'email' | 'text' | 'password';
  /** Encrypted at rest and never sent back to the browser. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** What the app sees: a connector's description and form. */
export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  kind: ConnectorKind;
  fields: readonly ConnectorField[];
}

interface ConnectorBase extends ConnectorInfo {
  /** Checks settings and returns them normalised; throws a ZodError on bad input. */
  validate(settings: unknown): Record<string, unknown>;
}

/** A kind of live source (Beszel today; Portainer, Prometheus, … later). */
export interface SourceConnector extends ConnectorBase {
  kind: 'source';
  /** Opens a client for validated settings. */
  open(settings: unknown): SourceClient;
}

/** A kind of alert destination (email, Slack, Teams, webhook). */
export interface ChannelConnector extends ConnectorBase {
  kind: 'channel';
  /** Sends one message; throws a ZodError when the stored settings are invalid. */
  send(settings: unknown, message: AlertMessage, deps: ChannelDeps): Promise<SendResult>;
}

export type Connector = SourceConnector | ChannelConnector;

/**
 * Builds a connector from a settings schema, so `validate` and `open` share
 * one parse and connectors stay type-safe without exposing their config type.
 */
export function defineConnector<Settings extends Record<string, unknown>>(definition: {
  info: Omit<ConnectorInfo, 'kind'>;
  schema: z.ZodType<Settings>;
  connect: (settings: Settings) => SourceClient;
}): SourceConnector {
  return {
    ...definition.info,
    kind: 'source',
    validate: (settings) => definition.schema.parse(settings),
    open: (settings) => definition.connect(definition.schema.parse(settings))
  };
}

/** Builds an alert channel from a settings schema and its send function. */
export function defineChannel<Settings extends Record<string, unknown>>(definition: {
  info: Omit<ConnectorInfo, 'kind'>;
  schema: z.ZodType<Settings>;
  send: ChannelConnector['send'];
}): ChannelConnector {
  return {
    ...definition.info,
    kind: 'channel',
    validate: (settings) => definition.schema.parse(settings),
    send: definition.send
  };
}

/** Settings without their secret fields, safe to send to the browser. */
export function publicSettings(
  connector: ConnectorInfo,
  settings: Record<string, unknown>
): { settings: Record<string, unknown>; secretsSet: string[] } {
  const visible: Record<string, unknown> = {};
  const secretsSet: string[] = [];
  for (const field of connector.fields) {
    const value = settings[field.name];
    if (field.secret) {
      if (value !== undefined && value !== '') secretsSet.push(field.name);
    } else if (value !== undefined) {
      visible[field.name] = value;
    }
  }
  return { settings: visible, secretsSet };
}
