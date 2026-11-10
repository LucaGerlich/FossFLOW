/** A failed API call, with the server's user-facing message and full answer. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Keep the request going while the page unloads (last-chance saves). */
  keepalive?: boolean;
}

/** Same-origin JSON calls; the session cookie travels automatically. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    keepalive: options.keepalive,
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const body = data as { error?: unknown; message?: unknown } | null;
    const message =
      typeof body?.error === 'string'
        ? body.error
        : typeof body?.message === 'string'
          ? body.message
          : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, data);
  }
  return data as T;
}
