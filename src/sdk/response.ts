/**
 * Reading SDK answers.
 *
 * Calls resolve `{success, result, error}`, except on older firmware, which
 * answers null from calls that worked. So only an explicit `success: false`
 * is a failure.
 */

interface Response<T> {
  success?: boolean;
  result?: T;
  error?: {message?: string};
}

/** Throw on an explicit SDK failure. */
export function check(res: unknown, what: string): void {
  const r = res as Response<unknown> | null | undefined;
  if (r && r.success === false) {
    throw new Error(`${what}: ${r.error?.message ?? 'failed'}`);
  }
}

/** A query whose answer is needed: failure or a missing result throws. */
export function answer<T>(res: unknown, what: string): T {
  check(res, what);
  const result = (res as Response<T> | null | undefined)?.result;
  if (result === undefined || result === null) {
    throw new Error(`${what}: no answer`);
  }
  return result;
}
