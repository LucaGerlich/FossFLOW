import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { describe, it, vi } from 'vitest';
import type { TrafficEvent } from '../ingest/spans.js';
import { TrafficHub } from './hub.js';
import type { TrafficDot, TrafficStreamMessage } from './wire.js';

const call = (overrides: Partial<TrafficEvent> = {}): TrafficEvent => ({
  kind: 'call',
  caller: 'service:shop',
  callee: 'host:api.example.com',
  operation: 'GET /v1/items',
  at: 1000,
  durationMs: 40,
  failed: false,
  status: null,
  ...overrides
});

const listen = (hub: TrafficHub, projectId: string) => {
  const messages: TrafficStreamMessage[] = [];
  const unsubscribe = hub.subscribe(projectId, (message) => messages.push(message));
  const dots = (): TrafficDot[] => messages.flatMap((message) => message.dots);
  return { messages, dots, unsubscribe };
};

describe('TrafficHub', () => {
  it("sends calls only to the project's subscribers", () => {
    const hub = new TrafficHub();
    const a = listen(hub, 'a');
    const b = listen(hub, 'b');
    hub.publish(
      'a',
      [
        call({ at: 1234, durationMs: 55, failed: true, status: '503' }),
        call({ kind: 'incoming', caller: '', callee: 'service:shop' })
      ],
      2000
    );
    assert.deepEqual(a.dots(), [
      {
        caller: 'service:shop',
        callee: 'host:api.example.com',
        start: 1234,
        durationMs: 55,
        failed: true,
        weight: 1
      }
    ]);
    assert.equal(a.messages[0]?.sentAt, 2000);
    assert.equal(b.messages.length, 0);
  });

  it('a flood is thinned to 20 dots with full weight', () => {
    const hub = new TrafficHub();
    const a = listen(hub, 'a');
    const events = Array.from({ length: 5000 }, (_, i) => call({ at: 1000 + ((i * 7) % 900) }));
    hub.publish('a', events, 2000);
    const dots = a.dots();
    assert.equal(dots.length, 20);
    assert.equal(dots.reduce((sum, dot) => sum + dot.weight, 0), 5000);
    for (let i = 1; i < dots.length; i += 1) {
      assert.ok((dots[i]?.start ?? 0) >= (dots[i - 1]?.start ?? 0));
    }
  });

  it('the project cap holds', () => {
    const hub = new TrafficHub();
    const a = listen(hub, 'a');
    const events = Array.from({ length: 30 }, (_, arrow) =>
      Array.from({ length: 20 }, () => call({ callee: `host:h${arrow}` }))
    ).flat();
    hub.publish('a', events, 2000);
    assert.equal(a.dots().length, 400);
  });

  it('budgets reset each second', () => {
    const hub = new TrafficHub();
    const a = listen(hub, 'a');
    const burst = () => Array.from({ length: 30 }, () => call());
    hub.publish('a', burst(), 1000);
    assert.equal(a.dots().length, 20);
    hub.publish('a', burst(), 1500);
    assert.equal(a.messages.length, 1);
    hub.publish('a', burst(), 2000);
    assert.equal(a.dots().length, 40);
  });

  it('keeps no state and sends nothing without subscribers', () => {
    const hub = new TrafficHub();
    hub.publish('a', [call()], 1000);
    const a = listen(hub, 'a');
    a.unsubscribe();
    hub.publish('a', [call()], 1000);
    assert.equal(a.messages.length, 0);
  });

  it("unsubscribe stops delivery, and a throwing listener doesn't stop the others", () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const hub = new TrafficHub();
    hub.subscribe('a', () => {
      throw new TypeError('boom');
    });
    const a = listen(hub, 'a');
    const b = listen(hub, 'a');
    hub.publish('a', [call()], 1000);
    assert.equal(a.messages.length, 1);
    assert.equal(b.messages.length, 1);
    a.unsubscribe();
    hub.publish('a', [call()], 2000);
    assert.equal(a.messages.length, 1);
    assert.equal(b.messages.length, 2);
    assert.match(String(logged.mock.calls[0]?.[0]), /TypeError/);
    assert.doesNotMatch(String(logged.mock.calls[0]?.[0]), /boom/);
    logged.mockRestore();
  });
});
