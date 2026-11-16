import type { TrafficStreamMessage } from 'src/traffic/types';

export const MIN_TRAVEL_MS = 800;
export const MAX_TRAVEL_MS = 4000;
export const MIN_LAG_MS = 2000;
export const MAX_LAG_MS = 15000;
export const MAX_PENDING = 2000;

const OFFSET_WINDOW = 20;
const LAG_SAMPLE_LIMIT = 200;
const LAG_SAMPLE_MAX_DURATION_MS = 2000;
const LAG_PADDING_MS = 500;
const LAG_STEP_MS = 500;

export type ActiveDot = {
  id: number;
  caller: string;
  callee: string;
  failed: boolean;
  weight: number;
  /** 0 to 1 along the arrow. */
  progress: number;
};

export type DotScheduler = {
  receive(message: TrafficStreamMessage, browserNow: number): void;
  due(browserNow: number): ActiveDot[];
  clear(): void;
  readonly lagMs: number;
  readonly offsetMs: number;
};

type PendingDot = Omit<ActiveDot, 'progress'> & {
  playAt: number;
  travelMs: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const percentile90 = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1];
};

export const createDotScheduler = (): DotScheduler => {
  let pending: PendingDot[] = [];
  let offsets: number[] = [];
  let lagSamples: number[] = [];
  let nextId = 1;

  const getOffset = (): number => (offsets.length ? Math.min(...offsets) : 0);

  const getLag = (): number => {
    if (lagSamples.length === 0) return MIN_LAG_MS;
    const padded = percentile90(lagSamples) + LAG_PADDING_MS;
    const rounded = Math.ceil(padded / LAG_STEP_MS) * LAG_STEP_MS;
    return clamp(rounded, MIN_LAG_MS, MAX_LAG_MS);
  };

  return {
    receive(message, browserNow) {
      offsets = [...offsets, browserNow - message.sentAt].slice(
        -OFFSET_WINDOW
      );
      const fresh = message.dots
        .filter((dot) => dot.durationMs <= LAG_SAMPLE_MAX_DURATION_MS)
        .map((dot) => message.sentAt - dot.start);
      lagSamples = [...lagSamples, ...fresh].slice(-LAG_SAMPLE_LIMIT);

      const offset = getOffset();
      const lag = getLag();
      const incoming = message.dots.map((dot): PendingDot => {
        const id = nextId;
        nextId += 1;
        return {
          id,
          caller: dot.caller,
          callee: dot.callee,
          failed: dot.failed,
          weight: dot.weight,
          playAt: Math.max(dot.start + offset + lag, browserNow),
          travelMs: clamp(dot.durationMs, MIN_TRAVEL_MS, MAX_TRAVEL_MS)
        };
      });
      pending = [...pending, ...incoming].slice(-MAX_PENDING);
    },

    due(browserNow) {
      pending = pending.filter((dot) => browserNow < dot.playAt + dot.travelMs);
      return pending
        .filter((dot) => dot.playAt <= browserNow)
        .map((dot) => ({
          id: dot.id,
          caller: dot.caller,
          callee: dot.callee,
          failed: dot.failed,
          weight: dot.weight,
          progress: (browserNow - dot.playAt) / dot.travelMs
        }));
    },

    clear() {
      pending = [];
    },

    get lagMs() {
      return getLag();
    },

    get offsetMs() {
      return getOffset();
    }
  };
};
