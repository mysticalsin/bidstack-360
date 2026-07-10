import { z } from 'zod';
import { CustomFieldValueLite, CustomFieldValueInput } from './custom-fields.js';

export const Sentiment = z.enum(['hot', 'warm', 'neutral', 'cold']);
export type Sentiment = z.infer<typeof Sentiment>;

export const Contact = z.object({
  id: z.string().uuid(),
  customer: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  role: z.string().max(255).nullable(),
  email: z.string().email().nullable(),
  phone: z.string().max(50).nullable(),
  influence: z.number().int().min(1).max(5).nullable(),
  sentiment: Sentiment.nullable(),
  createdAt: z.string().datetime(),
  customFieldValues: z.array(CustomFieldValueLite).optional(),
});
export type Contact = z.infer<typeof Contact>;

export const ContactCreate = Contact.omit({ id: true, createdAt: true });
export type ContactCreate = z.infer<typeof ContactCreate>;

// PATCH body — every field optional but at least one must be present.
// `customer` is editable (a contact can be re-assigned to another account)
// — server enforces multi-tenancy by re-checking orgId at the route layer.
export const ContactDetail = Contact.extend({
  relatedOpportunities: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      stage: z.string(),
      valueMicros: z.string(),
      probability: z.number(),
      dueDate: z.string().datetime().nullable(),
    }),
  ),
  relatedTasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: z.string(),
      dueDate: z.string().datetime().nullable(),
      assignee: z.string().nullable(),
    }),
  ),
  relatedNotes: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      authorName: z.string().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
});
export type ContactDetail = z.infer<typeof ContactDetail>;

export type ContactPatch = z.infer<typeof ContactPatch>;

// Bounds MUST mirror `Contact`/`ContactCreate` (customer/name/role .max(255),
// phone .max(50)). Omitting them let an over-length PATCH bypass validation and
// commit a value the 200:Contact response schema then can't serialize — a 500
// that also poisoned every subsequent read of that contact and the org list.
export const ContactPatch = z
  .object({
    customer: z.string().min(1).max(255).optional(),
    name: z.string().min(1).max(255).optional(),
    role: z.string().max(255).nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    influence: z.number().int().min(1).max(5).nullable().optional(),
    sentiment: Sentiment.nullable().optional(),
    customFieldValues: z.array(CustomFieldValueInput).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must contain at least one field',
  });

export const ContactFilter = z.object({
  customer: z.string().max(255).optional(),
  search: z.string().max(255).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ContactFilter = z.infer<typeof ContactFilter>;

export const ContactPage = z.object({
  items: z.array(Contact),
  nextCursor: z.string().nullable(),
});
export type ContactPage = z.infer<typeof ContactPage>;
