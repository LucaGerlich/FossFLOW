import type { LandscapeModel } from '../landscapes/model.js';

/**
 * Points live bindings at another source: keys `<from>:…` become `<to>:…`,
 * on nodes (`items[].live`) and on server plates (`views[].rectangles[].live`).
 * Used when the old `.env` Beszel login became a credential, whose id is the
 * new source id. Returns the model unchanged when nothing matched.
 */
export function rewriteLiveKeys(
  model: LandscapeModel,
  from: string,
  to: string
): { model: LandscapeModel; changed: boolean } {
  const prefix = `${from}:`;
  let changed = false;

  const rekey = (value: unknown): unknown => {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return value;
    changed = true;
    return `${to}:${value.slice(prefix.length)}`;
  };

  const rebind = <T extends Record<string, unknown>>(entry: T): T => {
    const live = entry.live;
    if (typeof live !== 'object' || live === null) return entry;
    const { key, known } = live as { key?: unknown; known?: unknown };
    return {
      ...entry,
      live: { ...live, key: rekey(key), ...(Array.isArray(known) ? { known: known.map(rekey) } : {}) }
    };
  };

  const next: LandscapeModel = {
    ...model,
    items: model.items.map(rebind),
    views: model.views.map((view) =>
      view.rectangles ? { ...view, rectangles: view.rectangles.map(rebind) } : view
    )
  };
  return changed ? { model: next, changed } : { model, changed };
}
