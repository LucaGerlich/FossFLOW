import { z } from 'zod';

/** n8n's rule: at least 8 characters, with a number and a capital letter. */
export const PASSWORD_RULE =
  'Passwords need at least 8 characters, including a number and a capital letter';

export const passwordSchema = z
  .string()
  .min(8, PASSWORD_RULE)
  .max(128, 'Passwords can be at most 128 characters')
  .regex(/[0-9]/, PASSWORD_RULE)
  .regex(/[A-Z]/, PASSWORD_RULE);
