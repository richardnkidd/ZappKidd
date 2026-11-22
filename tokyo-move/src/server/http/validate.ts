import type { ZodType } from 'zod';
import { validationError } from './errors';

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Parse with zod; on failure throw a 422 whose details list paths and messages (never the offending values). */
export function parseWith<T>(schema: ZodType<T>, input: unknown, what = 'Request'): T {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw validationError(`${what} did not pass validation`, issues);
}
