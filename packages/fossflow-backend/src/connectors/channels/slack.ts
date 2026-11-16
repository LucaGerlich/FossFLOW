import { z } from 'zod';
import { parseHttpsUrl } from '../outbound.js';
import { alertText } from './message.js';
import type { ChannelDefinition } from './types.js';

const schema = z.object({
  url: z
    .string()
    .max(2000)
    .refine(
      (value) => {
        const url = parseHttpsUrl(value);
        return url !== null && url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/');
      },
      { message: 'url must be a https://hooks.slack.com/services/… webhook' }
    )
});

export const slackChannel: ChannelDefinition<z.infer<typeof schema>> = {
  id: 'slack',
  name: 'Slack',
  description: 'Posts alerts to a Slack channel through an incoming webhook.',
  fields: [
    {
      name: 'url',
      label: 'Webhook URL',
      type: 'url',
      secret: true,
      required: true,
      placeholder: 'https://hooks.slack.com/services/…',
      help: 'Create an incoming webhook in your Slack workspace.'
    }
  ],
  schema,
  async send(settings, message, deps) {
    const { url } = schema.parse(settings);
    return deps.postJson(new URL(url), { text: alertText(message) }, { allowPrivate: false });
  }
};
