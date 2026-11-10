import { z } from 'zod';
import { createBeszelClient } from '../live/beszel.js';
import { parseSourceUrl } from '../live/config.js';
import { normalizeInventory } from '../live/normalize.js';
import { defineConnector } from './connector.js';

const settingsSchema = z.object({
  url: z.string().transform((value, context) => {
    const result = parseSourceUrl(value);
    if (!result.ok) {
      context.addIssue({ code: 'custom', message: `Hub URL ${result.problem}` });
      return z.NEVER;
    }
    return result.url;
  }),
  email: z.email('Enter the Beszel user’s email').max(254),
  password: z.string().min(1, 'Enter the Beszel user’s password').max(1000)
});

/** Servers, vitals and running containers from a Beszel hub. */
export const beszelConnector = defineConnector({
  info: {
    id: 'beszel',
    name: 'Beszel',
    description:
      'Servers, their vitals and running Docker containers from a Beszel hub. Use a Beszel user with the read-only role, and share the servers with it.',
    fields: [
      {
        name: 'url',
        label: 'Hub URL',
        type: 'url',
        secret: false,
        required: true,
        placeholder: 'https://beszel.example.com'
      },
      { name: 'email', label: 'Email', type: 'email', secret: false, required: true },
      { name: 'password', label: 'Password', type: 'password', secret: true, required: true }
    ]
  },
  schema: settingsSchema,
  connect: (settings) => {
    const client = createBeszelClient(settings);
    return {
      async fetch(context) {
        const inventory = await client.fetchInventory();
        return {
          systems: normalizeInventory({
            sourceId: context.sourceId,
            systems: inventory.systems,
            containers: inventory.containers,
            historyFor: context.historyFor,
            nowMs: context.nowMs
          }),
          skipped: inventory.skipped,
          truncated: inventory.truncated
        };
      }
    };
  }
});
