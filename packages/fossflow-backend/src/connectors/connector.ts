import type { z } from 'zod';
import type { SourceClient } from '../live/hub.js';

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
  fields: readonly ConnectorField[];
}

/** A kind of live source (Beszel today; Portainer, Prometheus, … later). */
export interface Connector extends ConnectorInfo {
  /** Checks settings and returns them normalised; throws a ZodError on bad input. */
  validate(settings: unknown): Record<string, unknown>;
  /** Opens a client for validated settings. */
  open(settings: unknown): SourceClient;
}

/**
 * Builds a connector from a settings schema, so `validate` and `open` share
 * one parse and connectors stay type-safe without exposing their config type.
 */
export function defineConnector<Settings extends Record<string, unknown>>(definition: {
  info: ConnectorInfo;
  schema: z.ZodType<Settings>;
  connect: (settings: Settings) => SourceClient;
}): Connector {
  return {
    ...definition.info,
    validate: (settings) => definition.schema.parse(settings),
    open: (settings) => definition.connect(definition.schema.parse(settings))
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
