import { z } from 'zod';

export const Sentiment = z.enum(['hot', 'warm', 'neutral', 'cold']);
export type Sentiment = z.infer<typeof Sentiment>;

export const Contact = z.object({
  id: z.string().uuid(),
  customer: z.string().min(1),
  name: z.string().min(1),
  role: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  influence: z.number().int().min(1).max(5).nullable(),
  sentiment: Sentiment.nullable(),
  createdAt: z.string().datetime(),
});
export type Contact = z.infer<typeof Contact>;

export const ContactCreate = Contact.omit({ id: true, createdAt: true });
export type ContactCreate = z.infer<typeof ContactCreate>;

// PATCH body — every field optional but at least one must be present.
// `customer` is editable (a contact can be re-assigned to another account)
// — server enforces multi-tenancy by re-checking orgId at the route layer.
export const ContactPatch = z
  .object({
    customer: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    role: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    influence: z.number().int().min(1).max(5).nullable().optional(),
    sentiment: Sentiment.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });
export type ContactPatch = z.infer<typeof ContactPatch>;
