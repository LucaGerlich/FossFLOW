const SQLSTATE = /^[0-9A-Z]{5}$/;

/** SQLSTATE of a Postgres error, also when Drizzle wraps it as the `cause`. */
export const sqlstateOf = (error: unknown): string | null => {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    current = cause;
  }
  return null;
};

/**
 * What to log about a failure: the error name and SQLSTATE only. Driver
 * messages and details can echo the values of the row that failed.
 */
export const describeError = (error: unknown): string => {
  const name = error instanceof Error ? error.name : 'unknown error';
  const code = sqlstateOf(error);
  return code ? `${name} SQLSTATE ${code}` : name;
};
