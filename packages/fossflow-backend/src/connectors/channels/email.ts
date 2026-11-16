import { z } from 'zod';
import { alertLine } from './message.js';
import type { ChannelDefinition } from './types.js';

const MAX_RECIPIENTS = 20;
const email = z.email();

function parseRecipients(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const schema = z.object({
  to: z
    .string()
    .max(4000)
    .refine(
      (value) => {
        const recipients = parseRecipients(value);
        return (
          recipients.length >= 1 &&
          recipients.length <= MAX_RECIPIENTS &&
          recipients.every((entry) => email.safeParse(entry).success)
        );
      },
      { message: `to must hold 1 to ${MAX_RECIPIENTS} valid email addresses` }
    )
    .transform((value) => parseRecipients(value).join(', '))
});

export const emailChannel: ChannelDefinition<z.infer<typeof schema>> = {
  id: 'email',
  name: 'Email',
  description: 'Sends alerts by email through the server SMTP settings.',
  fields: [
    {
      name: 'to',
      label: 'Recipients',
      type: 'text',
      secret: false,
      required: true,
      placeholder: 'ops@example.com, oncall@example.com',
      help: 'Separate addresses with commas or new lines (up to 20).'
    }
  ],
  schema,
  async send(settings, message, deps) {
    const { to } = schema.parse(settings);
    const line = alertLine(message);
    try {
      await deps.mailer.sendAlert(parseRecipients(to), line, `${line}\n\n${message.url}`);
      return { ok: true, status: null, retryAfterSeconds: null, error: null };
    } catch {
      return { ok: false, status: null, retryAfterSeconds: null, error: 'smtp' };
    }
  }
};
