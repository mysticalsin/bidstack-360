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
