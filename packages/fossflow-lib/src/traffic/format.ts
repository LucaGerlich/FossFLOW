/** 210/min, or one decimal below 10 (4.2/min). */
export const formatRate = (perMin: number): string =>
  perMin < 9.95 ? `${perMin.toFixed(1)}/min` : `${Math.round(perMin)}/min`;

/** 95 ms, or seconds with one decimal from 1000 ms (1.2 s). */
export const formatMs = (ms: number): string => {
  const rounded = Math.round(ms);
  return rounded < 1000 ? `${rounded} ms` : `${(ms / 1000).toFixed(1)} s`;
};

/** A 0-100 percentage with one decimal. */
export const formatPct = (pct: number): string => `${pct.toFixed(1)}%`;

/** Replaces `{name}` placeholders; the lib's t() has no interpolation. */
export const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
