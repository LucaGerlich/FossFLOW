import { z } from 'zod';
import { parseHttpsUrl } from '../outbound.js';
import { alertLine } from './message.js';
import type { ChannelDefinition } from './types.js';

const schema = z.object({
  url: z
    .string()
    .max(2000)
    .refine(
      (value) => {
        const url = parseHttpsUrl(value);
        return url !== null && url.hostname.endsWith('.api.powerplatform.com');
      },
      { message: 'url must be a Power Automate (*.api.powerplatform.com) workflow URL' }
    )
});

export const teamsChannel: ChannelDefinition<z.infer<typeof schema>> = {
  id: 'teams',
  name: 'Microsoft Teams',
  description: 'Posts alerts to Teams through a Power Automate workflow.',
  fields: [
    {
      name: 'url',
      label: 'Workflow URL',
      type: 'url',
      secret: true,
      required: true,
      placeholder: 'https://….api.powerplatform.com/…',
      help: 'Use the "Post to a channel when a webhook request is received" workflow.'
    }
  ],
  schema,
  async send(settings, message, deps) {
    const { url } = schema.parse(settings);
    const body = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [{ type: 'TextBlock', text: alertLine(message), weight: 'Bolder', wrap: true }],
            actions: [{ type: 'Action.OpenUrl', title: 'Open monitoring', url: message.url }]
          }
        }
      ]
    };
    return deps.postJson(new URL(url), body, { allowPrivate: false });
  }
};
