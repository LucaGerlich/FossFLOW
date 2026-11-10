import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Validates a request body; errors list the field and rule, never the value. */
export function parseBody<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      error: result.error.issues[0]?.message ?? 'Invalid request',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    });
  }
  return result.data;
}

/** A person's display name: setup, invitations and personal settings. */
export const personName = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
