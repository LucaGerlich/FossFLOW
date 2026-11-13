// Keep in sync with packages/fossflow-lib/src/traffic/types.ts.

/** One call to animate. `start` is epoch ms on the server clock. */
export type TrafficDot = {
  caller: string;
  callee: string;
  start: number;
  durationMs: number;
  failed: boolean;
  /** How many calls this dot stands for (1 unless the arrow was thinned). */
  weight: number;
};

export type TrafficStreamMessage = {
  /** Server clock when the message was sent, epoch ms. */
  sentAt: number;
  dots: TrafficDot[];
};
