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
  on(event: 'close', listener: () => void): void;
  readonly writableLength: number;
};

type Timing = { heartbeatMs: number; maxMs: number };

/** Serves traffic messages as server-sent events until the caller hangs up, falls behind or times out. */
export function openTrafficStream(
  target: StreamTarget,
  subscribe: (listener: (message: TrafficStreamMessage) => void) => () => void,
  timing: Timing = { heartbeatMs: HEARTBEAT_MS, maxMs: MAX_STREAM_MS }
): void {
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
  const send = (chunk: string): void => {
    if (!open) return;
    if (target.writableLength > MAX_BUFFERED_BYTES) {
      finish();
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
  unsubscribe = subscribe((message) => send(`data: ${JSON.stringify(message)}\n\n`));
  heartbeat = setInterval(() => send(': ping\n\n'), timing.heartbeatMs);
  limit = setTimeout(finish, timing.maxMs);
}
