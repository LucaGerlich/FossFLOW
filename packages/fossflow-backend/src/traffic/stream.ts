import type { TrafficStreamMessage } from './wire.js';

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAM_MS = 600_000;
export const RETRY_MS = 2_000;
export const MAX_BUFFERED_BYTES = 1_048_576;
export const MAX_STREAMS_PER_USER = 10;

/** What a stream needs from a response; an Express `Response` satisfies it. */
export type StreamTarget = {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  on(event: 'close', listener: () => void): void;
  readonly writableLength: number;
  readonly destroyed: boolean;
};

const serialised = new WeakMap<TrafficStreamMessage, string>();

/** One JSON string per message, however many listeners receive it. */
const encode = (message: TrafficStreamMessage): string => {
  const cached = serialised.get(message);
  if (cached !== undefined) return cached;
  const chunk = `data: ${JSON.stringify(message)}\n\n`;
  serialised.set(message, chunk);
  return chunk;
};

type Timing = { heartbeatMs: number; maxMs: number };

/** Serves traffic messages as server-sent events until the caller hangs up, falls behind or times out. */
export function openTrafficStream(
  target: StreamTarget,
  subscribe: (listener: (message: TrafficStreamMessage) => void) => () => void,
  timing: Timing = { heartbeatMs: HEARTBEAT_MS, maxMs: MAX_STREAM_MS }
): void {
  // The client may have left while access was being checked; `close` won't fire again.
  if (target.destroyed) return;
  let open = true;
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let limit: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
    clearTimeout(limit);
    unsubscribe();
  };
  const finish = (): void => {
    stop();
    target.end();
  };
  // A graceful end() queues behind the unread buffer, so `close` might never fire.
  const cutOff = (): void => {
    stop();
    target.destroy();
  };
  const send = (chunk: string): void => {
    if (!open) return;
    if (target.writableLength > MAX_BUFFERED_BYTES) {
      cutOff();
      return;
    }
    target.write(chunk);
  };

  target.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no'
  });
  target.write(`retry: ${RETRY_MS}\n\n`);
  target.on('close', stop);
  unsubscribe = subscribe((message) => send(encode(message)));
  heartbeat = setInterval(() => send(': ping\n\n'), timing.heartbeatMs);
  limit = setTimeout(finish, timing.maxMs);
}
