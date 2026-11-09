import { z } from 'zod';
import { id, constrainedStrings, liveBinding } from './common';

export const modelItemSchema = z.object({
  id,
  name: constrainedStrings.name,
  description: constrainedStrings.description.optional(),
  icon: id.optional(),
  live: liveBinding.optional()
});

export const modelItemsSchema = z.array(modelItemSchema);
