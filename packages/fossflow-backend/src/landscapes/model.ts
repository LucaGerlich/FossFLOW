import { z } from 'zod';

const entry = z.record(z.string(), z.unknown());

/** A tile position; zod 4 numbers reject NaN and Infinity, JSON turns NaN into null. */
const tile = z.object({ x: z.number(), y: z.number() });

/**
 * A view, checked where a bad value would stop the editor from opening the
 * landscape again: every position must be a real number.
 */
const view = z
  .object({
    id: z.string().min(1),
    items: z.array(z.object({ id: z.string().min(1), tile }).loose()).max(20_000).default([]),
    rectangles: z.array(z.object({ from: tile, to: tile }).loose()).max(5_000).optional(),
    textBoxes: z.array(z.object({ tile }).loose()).max(5_000).optional(),
    connectors: z.array(entry).max(20_000).optional()
  })
  .loose();

/**
 * The stored shape of a FossFLOW model. This checks the outline, every
 * position, and bounds every collection; the editor validates the remaining
 * details with the lib's schema.
 * ponytail: structural check; move the lib's full schema server-side if
 * other bad data ever gets through.
 * Unknown top-level fields (e.g. `fitToScreen`, `id`) are dropped. Icons are
 * stored without the built-in packs, which the editor adds when it opens.
 */
export const landscapeModelSchema = z.object({
  title: z.string().max(200).optional(),
  version: z.string().max(10).optional(),
  description: z.string().max(10_000).optional(),
  icons: z.array(entry).max(5_000).default([]),
  colors: z.array(entry).max(500).default([]),
  items: z.array(entry).max(20_000).default([]),
  views: z.array(view).max(200).default([])
});

export type LandscapeModel = z.infer<typeof landscapeModelSchema>;

/** A blank landscape with one view, like a new diagram in the editor. */
export function emptyModel(title: string): LandscapeModel {
  return { title, icons: [], colors: [], items: [], views: [] };
}

/** Keeps only icons people imported; built-in packs are re-added on load. */
export function withoutBuiltInIcons(model: LandscapeModel): LandscapeModel {
  return { ...model, icons: model.icons.filter((icon) => icon.collection === 'imported') };
}
