import type { z } from 'zod';

import type { ValidationIssue } from '@romp/contracts';

import { ValidationFailedError } from './errors';

/**
 * Turns a `ZodError` into field-level validation issues.
 *
 * Paths are dotted with array indices inline — `items.0.qty` — because clients map
 * them straight onto form field names. A JSON Pointer would be more standard and
 * less usable.
 */
export function zodIssuesToValidationIssues(error: z.ZodError): readonly ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }));
}

/**
 * An empty path means the failure is about the value as a whole rather than a
 * field — a union that matched nothing, a top-level type mismatch. Reporting it as
 * `''` would render as a blank field name, so it is named explicitly.
 */
function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.map((segment) => String(segment)).join('.');
}

export function validationErrorFromZod(error: z.ZodError, detail?: string): ValidationFailedError {
  return new ValidationFailedError(zodIssuesToValidationIssues(error), {
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * Parses with a schema, throwing `ValidationFailedError` on failure.
 *
 * The point of routing every boundary through this is that a validation failure
 * always produces the same response shape with usable field paths, rather than
 * whichever of Zod's several error renderings a given handler happened to reach for.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  detail?: string,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationErrorFromZod(result.error, detail);
  }
  return result.data;
}
