import { z } from 'zod';

export const coords = z.object({
  x: z.number(),
  y: z.number()
});

export const id = z.string();
export const color = z.string();

export const constrainedStrings = {
  name: z.string().max(100),
  description: z.string().max(1000)
};

/** Binds a node or rectangle to a live-data entity, e.g. `beszel:<systemId>/<container>`. */
export const liveBinding = z.object({
  key: z.string().min(1).max(300),
  /** On server plates: container keys already placed (deleted ones stay hidden). */
  known: z.array(z.string().min(1).max(300)).max(2000).optional()
});
