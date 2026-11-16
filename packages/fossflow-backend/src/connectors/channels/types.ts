import type { z } from 'zod';
import type { Mailer } from '../../mail/mailer.js';
import type { ConnectorField } from '../connector.js';
import type { postJson, PostResult } from '../outbound.js';
import type { AlertMessage } from './message.js';

export interface ChannelDeps {
  postJson: typeof postJson;
  mailer: Mailer;
}

export type SendResult =
  | PostResult
  | { ok: boolean; status: null; retryAfterSeconds: null; error: 'smtp' | null };

/** A kind of alert destination; Task 2 wraps these into credential types. */
export interface ChannelDefinition<Settings extends Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  fields: readonly ConnectorField[];
  schema: z.ZodType<Settings>;
  send(settings: unknown, message: AlertMessage, deps: ChannelDeps): Promise<SendResult>;
}
