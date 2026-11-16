import { beszelConnector } from './beszel.js';
import { emailChannel } from './channels/email.js';
import { slackChannel } from './channels/slack.js';
import { teamsChannel } from './channels/teams.js';
import type { ChannelDefinition } from './channels/types.js';
import { webhookChannel } from './channels/webhook.js';
import { type Connector, type ConnectorInfo, defineChannel } from './connector.js';

function channelConnector(definition: ChannelDefinition<Record<string, unknown>>): Connector {
  const { schema, send, ...info } = definition;
  return defineChannel({ info, schema, send });
}

/** Every live source and alert channel FossFLOW supports. A new one is an entry here. */
export const CONNECTORS: readonly Connector[] = [
  beszelConnector,
  channelConnector(emailChannel),
  channelConnector(slackChannel),
  channelConnector(teamsChannel),
  channelConnector(webhookChannel)
];

export function findConnector(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/** What the app may offer; email needs the server's SMTP settings. */
export function connectorInfos({ smtpEnabled }: { smtpEnabled: boolean }): ConnectorInfo[] {
  return CONNECTORS.filter((connector) => smtpEnabled || connector.id !== 'email').map(
    ({ id, name, description, kind, fields }) => ({ id, name, description, kind, fields })
  );
}
