import {
  DS_COLORS,
  DS_DROP_SHADOWS,
  DS_FONTS,
  DS_RADII
} from 'fossflow';

const kebab = (key: string): string =>
  key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/**
 * Writes the library's design tokens as CSS custom properties (--ds-*), so the
 * app's plain CSS and the editor share one source of truth.
 */
export function applyDesignTokens(
  root: HTMLElement = document.documentElement
): void {
  for (const [key, value] of Object.entries(DS_COLORS)) {
    root.style.setProperty(`--ds-${kebab(key)}`, value);
  }
  root.style.setProperty('--ds-font-sans', DS_FONTS.sans);
  root.style.setProperty('--ds-font-mono', DS_FONTS.mono);
  for (const [key, value] of Object.entries(DS_RADII)) {
    root.style.setProperty(`--ds-radius-${key}`, `${value}px`);
  }
  for (const [level, value] of Object.entries(DS_DROP_SHADOWS)) {
    root.style.setProperty(`--ds-shadow-${level}`, value);
  }
  root.style.setProperty('--ds-ring', 'inset 0 0 0 1px rgba(0,0,0,0.08)');
}

/**
 * Resolves once Geist is available (or after a short timeout), so canvas text
 * is measured with the real font rather than a fallback.
 */
export async function fontsReady(timeoutMs = 1500): Promise<void> {
  if (!document.fonts?.load) return;
  const loads = Promise.all([
    document.fonts.load("400 14px 'Geist Variable'"),
    document.fonts.load("600 14px 'Geist Variable'"),
    document.fonts.load("400 12px 'Geist Mono Variable'")
  ]);
  await Promise.race([
    loads,
    new Promise((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
}
