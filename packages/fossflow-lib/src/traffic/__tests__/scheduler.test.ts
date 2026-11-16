import {
  createDotScheduler,
  MAX_PENDING
} from 'src/traffic/scheduler';
import type { TrafficDot, TrafficStreamMessage } from 'src/traffic/types';

const dot = (overrides: Partial<TrafficDot> = {}): TrafficDot => ({
  caller: 'service:a',
  callee: 'service:b',
  start: 0,
  durationMs: 100,
  failed: false,
  weight: 1,
  ...overrides
});

const message = (
  sentAt: number,
  dots: TrafficDot[]
): TrafficStreamMessage => ({ sentAt, dots });

describe('createDotScheduler', () => {
  it('a browser 5 minutes ahead still plays one lag after the call', () => {
    const scheduler = createDotScheduler();
    const sentAt = 1_000_000;
    const browserNow = 1_300_000;
    scheduler.receive(message(sentAt, [dot({ start: 999_800 })]), browserNow);

    expect(scheduler.offsetMs).toBe(300_000);
    expect(scheduler.lagMs).toBe(2000);
    const playAt = 999_800 + 300_000 + 2000;
    expect(scheduler.due(playAt - 1)).toEqual([]);
    expect(scheduler.due(playAt)).toHaveLength(1);
  });

  it('keeps the lag at 2000 for delays around 300 ms', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 999_700 }), dot({ start: 999_650 })]),
      1_000_000
    );
    expect(scheduler.lagMs).toBe(2000);
  });

  it('caps the lag at 15000 for delays of 30 s', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(message(1_000_000, [dot({ start: 970_000 })]), 1_000_000);
    expect(scheduler.lagMs).toBe(15000);
  });

  it('rounds the lag up to the next 500 ms', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(message(1_000_000, [dot({ start: 996_000 })]), 1_000_000);
    // 4000 + 500 = 4500
    expect(scheduler.lagMs).toBe(4500);
    const other = createDotScheduler();
    other.receive(message(1_000_000, [dot({ start: 996_100 })]), 1_000_000);
    // 3900 + 500 = 4400 -> 4500
    expect(other.lagMs).toBe(4500);
  });

  it('ignores slow calls when measuring lag', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 900_000, durationMs: 5000 })]),
      1_000_000
    );
    expect(scheduler.lagMs).toBe(2000);
  });

  it('plays a dot whose play time has passed at once', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(message(1_000_000, [dot({ start: 990_000, durationMs: 3000 })]), 1_000_000);
    expect(scheduler.due(1_000_000)).toHaveLength(1);
    expect(scheduler.due(1_000_000)[0].progress).toBe(0);
  });

  it('clamps travel time to 800 ms at the low end', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 1_000_000, durationMs: 50 })]),
      1_000_000
    );
    const playAt = 1_002_000;
    expect(scheduler.due(playAt + 799)).toHaveLength(1);
    expect(scheduler.due(playAt + 800)).toHaveLength(0);
  });

  it('clamps travel time to 4000 ms at the high end', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 1_000_000, durationMs: 10_000 })]),
      1_000_000
    );
    const playAt = 1_002_000;
    expect(scheduler.due(playAt + 3999)).toHaveLength(1);
    expect(scheduler.due(playAt + 4000)).toHaveLength(0);
  });

  it('reports half progress halfway through travel and forgets finished dots', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 1_000_000, durationMs: 1000 })]),
      1_000_000
    );
    const playAt = 1_002_000;
    const [active] = scheduler.due(playAt + 500);
    expect(active.progress).toBe(0.5);
    expect(active.caller).toBe('service:a');
    expect(active.callee).toBe('service:b');
    expect(scheduler.due(playAt + 1000)).toEqual([]);
    expect(scheduler.due(playAt + 500)).toEqual([]);
  });

  it('gives every dot its own id', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(
      message(1_000_000, [dot({ start: 990_000, durationMs: 3000 }), dot({ start: 990_000, durationMs: 3000 })]),
      1_000_000
    );
    const ids = scheduler.due(1_000_000).map((d) => d.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('clear() leaves due empty', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(message(1_000_000, [dot({ start: 990_000, durationMs: 3000 })]), 1_000_000);
    scheduler.clear();
    expect(scheduler.due(1_000_000)).toEqual([]);
  });

  it('keeps the newest 2000 of 2500 received dots', () => {
    const scheduler = createDotScheduler();
    const dots = Array.from({ length: 2500 }, (_, i) =>
      dot({ start: 990_000, durationMs: 3000, caller: `service:${i}` })
    );
    scheduler.receive(message(1_000_000, dots), 1_000_000);
    const due = scheduler.due(1_000_000);
    expect(MAX_PENDING).toBe(2000);
    expect(due).toHaveLength(2000);
    expect(due[0].caller).toBe('service:500');
    expect(due[1999].caller).toBe('service:2499');
  });

  it('uses the minimum offset of the last 20 messages', () => {
    const scheduler = createDotScheduler();
    scheduler.receive(message(1_000_000, []), 1_000_050);
    expect(scheduler.offsetMs).toBe(50);
    scheduler.receive(message(1_001_000, []), 1_001_020);
    expect(scheduler.offsetMs).toBe(20);
    for (let i = 0; i < 20; i += 1) {
      scheduler.receive(message(1_002_000 + i, []), 1_002_000 + i + 100);
    }
    expect(scheduler.offsetMs).toBe(100);
  });
});
