import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

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
