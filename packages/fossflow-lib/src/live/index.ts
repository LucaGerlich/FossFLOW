// Public, framework-free exports of the live feature (safe for the standalone bundle).
export {
  HAIRLINE_COLLECTION,
  HAIRLINE_ICON_IDS,
  HAIRLINE_ICONS,
  getHairlineStatusOffset
} from './hairlineIcons';
export type { HairlineKind } from './hairlineIcons';
export type {
  LiveContainer,
  LiveContainerKind,
  LiveDisplayStatus,
  LiveHealth,
  LiveHistory,
  LiveSnapshot,
  LiveSourceHealth,
  LiveSourceStatus,
  LiveSystem,
  LiveVitals
} from './types';
