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

/** Binds a node or rectangle to a live-data entity, e.g. `<sourceId>:<systemId>/<container>`; the source id is a credential id. */
export const liveBinding = z.object({
  key: z.string().min(1).max(300),
  /** On server plates: container keys already placed (deleted ones stay hidden). */
  known: z.array(z.string().min(1).max(300)).max(2000).optional()
});

/** One traffic identity: `service:<name>`, `host:<host>` or `db:<host>/<name>`. A leading `*.` after the prefix is the only wildcard. */
export const trafficIdentity = z
  .string()
  .min(1)
  .max(300)
  // eslint-disable-next-line no-control-regex
  .regex(/^(service|host|db):(\*\.)?[^*\u0000-\u001f]+$/);

/** Binds a box to the traffic identities whose calls it owns. */
export const trafficBinding = z.object({
  ids: z.array(trafficIdentity).max(20)
});
