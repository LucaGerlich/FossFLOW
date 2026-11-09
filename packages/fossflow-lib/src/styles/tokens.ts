/**
 * Design tokens from the project's design file (Vercel-inspired: ink on
 * near-white, hairlines, Geist). Single source for the MUI theme, the live
 * overlay and the host app (exported from the package).
 */

export const DS_COLORS = {
  ink: '#171717',
  onInk: '#ffffff',
  body: '#4d4d4d',
  mute: '#888888',
  hairline: '#ebebeb',
  hairlineStrong: '#a1a1a1',
  canvas: '#ffffff',
  canvasSoft: '#fafafa',
  canvasSoft2: '#f5f5f5',
  link: '#0070f3',
  linkDeep: '#0761d1',
  linkBgSoft: '#d3e5ff',
  error: '#ee0000',
  errorSoft: '#f7d4d6',
  errorDeep: '#c50000',
  warning: '#f5a623',
  warningSoft: '#ffefcf',
  warningDeep: '#ab570a',
  ok: '#29bc9b',
  okSoft: '#aaffec'
} as const;

/** Host apps self-host the variable fonts; static Geist and Inter are fallbacks. */
export const DS_FONTS = {
  sans: "'Geist Variable', Geist, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
} as const;

export const DS_RADII = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12
} as const;

const HAIRLINE_RING = 'inset 0 0 0 1px rgba(0,0,0,0.08)';

/** Stacked shadows: several small offsets plus a hairline ring, never one heavy drop. */
export const DS_SHADOWS = {
  1: HAIRLINE_RING,
  2: `0 1px 1px rgba(0,0,0,0.02), 0 2px 2px rgba(0,0,0,0.04), ${HAIRLINE_RING}`,
  3: `0 2px 2px rgba(0,0,0,0.04), 0 8px 8px -8px rgba(0,0,0,0.04), ${HAIRLINE_RING}`,
  4: `0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.04), ${HAIRLINE_RING}`,
  5: `0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06), ${HAIRLINE_RING}`
} as const;

/** The same levels without the inset ring, for elements that draw their own border. */
export const DS_DROP_SHADOWS = {
  2: '0 1px 1px rgba(0,0,0,0.02), 0 2px 2px rgba(0,0,0,0.04)',
  4: '0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.04)',
  5: '0 1px 1px rgba(0,0,0,0.02), 0 8px 16px -4px rgba(0,0,0,0.04), 0 24px 32px -8px rgba(0,0,0,0.06)'
} as const;
