import { z } from 'zod';
import { parseHttpsUrl } from '../outbound.js';
import type { ChannelDefinition } from './types.js';

const schema = z.object({
  url: z
    .string()
    .max(2000)
    .refine((value) => parseHttpsUrl(value) !== null, {
      message: 'url must be an https URL without a username or password'
    })
});

export const webhookChannel: ChannelDefinition<z.infer<typeof schema>> = {
  id: 'webhook',
  name: 'Webhook',
  description: 'Posts alerts as JSON to any HTTPS endpoint, including ones on your own network.',
  fields: [
    {
      name: 'url',
      label: 'URL',
      type: 'url',
      secret: true,
      required: true,
      placeholder: 'https://example.com/hooks/fossflow'
    }
  ],
  schema,
  async send(settings, message, deps) {
    const { url } = schema.parse(settings);
    const body = {
      rule: { id: message.ruleId, name: message.ruleName, kind: message.kind },
      state: message.state,
      target: message.target,
      value: message.value,
      threshold: message.threshold,
      windowMinutes: message.windowMinutes,
      startedAt: message.startedAt,
      url: message.url
    };
    return deps.postJson(new URL(url), body, { allowPrivate: true });
  }
};
