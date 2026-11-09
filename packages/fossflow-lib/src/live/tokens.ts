import type { LiveDisplayStatus } from './types';

/** Colour tokens from the project's design file. Colour means trouble only. */
export const LIVE_TOKENS = {
  ink: '#171717',
  body: '#4d4d4d',
  mute: '#888888',
  hairline: '#ebebeb',
  hairlineStrong: '#a1a1a1',
  canvas: '#ffffff',
  canvasSoft: '#fafafa',
  ok: '#29bc9b',
  warning: '#f5a623',
  warningSoft: '#ffefcf',
  warningDeep: '#ab570a',
  critical: '#ee0000',
  criticalSoft: '#f7d4d6',
  criticalDeep: '#c50000',
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
  sans: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** Stacked shadow from the design file (level 4) plus an inset hairline. */
  cardShadow:
    '0 0 0 1px rgba(0,0,0,0.08), 0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.04)'
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
