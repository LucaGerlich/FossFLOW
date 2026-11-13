import { TEST_ORIGIN } from './app.js';

export interface OpenStream {
  status: number;
  headers: Headers;
  /** The next complete event block (without the blank line), skipping nothing. */
  next: () => Promise<string>;
  close: () => void;
}

let clients = 0;

/** A unique client IP per call, as nginx would report it, so streams don't share a throttle bucket. */
const nextIp = (): string => {
  clients += 1;
  return `10.99.${Math.floor(clients / 250)}.${(clients % 250) + 1}`;
};

/** Signs in with fetch and returns the cookie header to send on later requests. */
export async function signIn(baseUrl: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN, 'X-Real-IP': nextIp() },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`Sign-in failed with ${response.status}`);
  await response.arrayBuffer();
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/** Opens a server-sent events stream with fetch; call `close` to hang up. */
export async function openStream(baseUrl: string, path: string, cookie: string): Promise<OpenStream> {
  const controller = new AbortController();
  const headers: Record<string, string> = { Origin: TEST_ORIGIN, 'X-Real-IP': nextIp() };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body || !contentType.startsWith('text/event-stream')) {
    await response.arrayBuffer();
    return { status: response.status, headers: response.headers, next: () => Promise.reject(new Error('No stream')), close: () => undefined };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async (): Promise<string> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return block;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return {
    status: response.status,
    headers: response.headers,
    next,
    close: () => controller.abort()
  };
}
