import { DS_COLORS, DS_FONTS, DS_SHADOWS } from 'src/styles/tokens';
import type { LiveDisplayStatus } from './types';

/** Live-overlay view of the shared design tokens. Colour means trouble only. */
export const LIVE_TOKENS = {
  ink: DS_COLORS.ink,
  body: DS_COLORS.body,
  mute: DS_COLORS.mute,
  hairline: DS_COLORS.hairline,
  hairlineStrong: DS_COLORS.hairlineStrong,
  canvas: DS_COLORS.canvas,
  canvasSoft: DS_COLORS.canvasSoft,
  ok: DS_COLORS.ok,
  warning: DS_COLORS.warning,
  warningSoft: DS_COLORS.warningSoft,
  warningDeep: DS_COLORS.warningDeep,
  critical: DS_COLORS.error,
  criticalSoft: DS_COLORS.errorSoft,
  criticalDeep: DS_COLORS.errorDeep,
  mono: DS_FONTS.mono,
  sans: DS_FONTS.sans,
  cardShadow: DS_SHADOWS[4]
} as const;

/** Same thresholds as the backend's status rules (normalize.ts). */
export const VITAL_WARNING = 80;
export const VITAL_CRITICAL = 90;

export const STATUS_COLOR: Record<LiveDisplayStatus, string> = {
  ok: LIVE_TOKENS.ok,
  warning: LIVE_TOKENS.warning,
  critical: LIVE_TOKENS.critical,
  unknown: LIVE_TOKENS.hairlineStrong,
  stopped: LIVE_TOKENS.hairlineStrong
};

/** Text colour for a status (ink when healthy: colour only for trouble). */
export const STATUS_TEXT: Record<LiveDisplayStatus, string> = {
  ok: LIVE_TOKENS.mute,
  warning: LIVE_TOKENS.warningDeep,
  critical: LIVE_TOKENS.criticalDeep,
  unknown: LIVE_TOKENS.mute,
  stopped: LIVE_TOKENS.mute
};
