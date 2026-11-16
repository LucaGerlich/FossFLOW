/**
 * Traffic data passed to `<Isoflow traffic={...} />`.
 *
 * Mirrors the backend wire contract in
 * `packages/fossflow-backend/src/traffic/wire.ts`; keep both in sync.
 */

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

export interface TrafficPair {
  caller: string;
  callee: string;
}

export interface TrafficStats {
  calls: number;
  failures: number;
  callsPerMin: number;
  /** 0–100. */
  failedPct: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

/** 'host:b.internal' is served by 'service:B'. */
export interface TrafficAlias {
  host: string;
  service: string;
}

export type AlertTarget =
  | { type: 'arrow'; from: string; to: string }
  | { type: 'box'; identity: string };

/** An open alert of the landscape's project. */
export interface TrafficAlert {
  ruleId: string;
  name: string;
  kind: 'failing' | 'slow' | 'silent';
  target: AlertTarget;
  startedAt: string;
  /** Silent: minutes since the last call. */
  value: number | null;
}

export interface TrafficSummary {
  generatedAt: string;
  windowMinutes: number;
  edges: (TrafficPair & TrafficStats & { lastSeenAt: string })[];
  callees: ({ callee: string } & TrafficStats)[];
  services: ({ service: string } & TrafficStats)[];
  aliases: TrafficAlias[];
  /** Open alerts, newest first. */
  alerts: TrafficAlert[];
}

export type TrafficRange = '1h' | '24h' | '7d';

export interface TrafficEdgeDetail {
  range: TrafficRange;
  stepSeconds: 60 | 3600;
  totals: TrafficStats;
  series: { at: string; calls: number; failures: number; p95Ms: number | null }[];
  operations: {
    operation: string;
    calls: number;
    failures: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }[];
  failures: {
    at: string;
    caller: string;
    callee: string;
    operation: string;
    status: string;
    durationMs: number;
  }[];
}

/** What the host app needs to open a rule form for a card. */
export type AlertRequest =
  | { type: 'arrow'; from: string[]; to: string[]; name: string }
  | { type: 'box'; identities: string[]; name: string };

export interface TrafficFeed {
  summary: TrafficSummary | undefined;
  subscribe: (listener: (message: TrafficStreamMessage) => void) => () => void;
  loadEdge: (
    pairs: TrafficPair[],
    range: TrafficRange
  ) => Promise<TrafficEdgeDetail>;
  /** Opens the host app's rule form; leave undefined when people can't create rules. */
  requestAlert?: (request: AlertRequest) => void;
}
