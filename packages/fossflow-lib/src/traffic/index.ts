// Public, framework-free exports of the traffic feature (safe for the standalone bundle).
export type {
  AlertRequest,
  AlertTarget,
  TrafficAlert,
  TrafficAlias,
  TrafficDot,
  TrafficEdgeDetail,
  TrafficFeed,
  TrafficPair,
  TrafficRange,
  TrafficStats,
  TrafficStreamMessage,
  TrafficSummary
} from './types';
export {
  boxOf,
  buildTrafficIndex,
  createRouter,
  findArrow,
  matchesIdentity
} from './match';
export type { ArrowMatch, TrafficBox, TrafficIndex } from './match';
