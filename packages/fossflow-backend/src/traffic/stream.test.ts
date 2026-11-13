import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { MAX_BUFFERED_BYTES, openTrafficStream, type StreamTarget } from './stream.js';
import type { TrafficStreamMessage } from './wire.js';

const message: TrafficStreamMessage = {
  sentAt: 1_700_000_000_000,
  dots: [
    {
      caller: 'service:a',
      callee: 'host:b',
      start: 1_699_999_999_000,
      durationMs: 25,
      failed: false,
      weight: 1
    }
  ]
};

const setup = () => {
  const writes: string[] = [];
  const heads: { status: number; headers: Record<string, string> }[] = [];
  let closeListener: (() => void) | undefined;
  let ended = 0;
  let unsubscribed = 0;
  let listener: ((m: TrafficStreamMessage) => void) | undefined;
  const target = {
    writableLength: 0,
    destroyed: false,
    writeHead: (status: number, headers: Record<string, string>) => {
      heads.push({ status, headers });
    },
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: () => {
      ended += 1;
    },
    on: (_event: 'close', fn: () => void) => {
      closeListener = fn;
    }
  };
  const subscribe = (fn: (m: TrafficStreamMessage) => void) => {
    listener = fn;
    return () => {
      unsubscribed += 1;
    };
  };
  return {
    target: target as StreamTarget & { writableLength: number; destroyed: boolean },
    subscribe,
    writes,
    heads,
    publish: (m: TrafficStreamMessage) => listener?.(m),
    close: () => closeListener?.(),
    ended: () => ended,
    unsubscribed: () => unsubscribed
  };
};

describe('openTrafficStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the event-stream head and a retry hint first', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    assert.deepEqual(s.heads, [
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no'
        }
      }
    ]);
    assert.equal(s.writes[0], 'retry: 2000\n\n');
  });

  it('writes each message as a data event', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    s.publish(message);
    assert.equal(s.writes[1], `data: ${JSON.stringify(message)}\n\n`);
  });

  it('pings every 25 seconds', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    vi.advanceTimersByTime(24_999);
    assert.equal(s.writes.includes(': ping\n\n'), false);
    vi.advanceTimersByTime(1);
    assert.equal(s.writes.filter((w) => w === ': ping\n\n').length, 1);
    vi.advanceTimersByTime(25_000);
    assert.equal(s.writes.filter((w) => w === ': ping\n\n').length, 2);
  });

  it('ends after ten minutes and unsubscribes', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    vi.advanceTimersByTime(599_999);
    assert.equal(s.ended(), 0);
    vi.advanceTimersByTime(1);
    assert.equal(s.ended(), 1);
    assert.equal(s.unsubscribed(), 1);
  });

  it('writes nothing and fires no timer after close', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    s.close();
    assert.equal(s.unsubscribed(), 1);
    const before = s.writes.length;
    s.publish(message);
    vi.advanceTimersByTime(700_000);
    assert.equal(s.writes.length, before);
    assert.equal(s.ended(), 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('ends instead of writing when too much is buffered', () => {
    const s = setup();
    openTrafficStream(s.target, s.subscribe);
    const before = s.writes.length;
    s.target.writableLength = MAX_BUFFERED_BYTES + 1;
    s.publish(message);
    assert.equal(s.writes.length, before);
    assert.equal(s.ended(), 1);
    assert.equal(s.unsubscribed(), 1);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('does nothing for a target that is already closed', () => {
    const s = setup();
    s.target.destroyed = true;
    let subscribed = 0;
    openTrafficStream(s.target, (listener) => {
      subscribed += 1;
      return s.subscribe(listener);
    });
    assert.equal(subscribed, 0);
    assert.equal(s.heads.length, 0);
    assert.equal(s.writes.length, 0);
    assert.equal(vi.getTimerCount(), 0);
  });
});
