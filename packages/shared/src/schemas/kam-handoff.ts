/**
 * kam-handoff.ts — the interface to ABC's Opportunity-Management section.
 *
 * A KamHandoff is minted atomically when an Initiative reaches `opportunity`
 * (see kam-initiatives transition). This module is the EXPORT side: it produces
 * a stable, structured payload ABC's OM can ingest. Per Tony's decision, OM is a
 * section inside ABC and no write API exists yet, so export = produce the
 * downloadable payload + mark the handoff exported. A future ABC connector
 * delivers the same payload over the wire without changing this contract.
 */
import { z } from 'zod';

export const KamHandoffDetail = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  initiativeId: z.string().uuid(),
  opportunityId: z.string().uuid().nullable(),
  status: z.enum(['draft', 'exported', 'confirmed']),
  targetSystem: z.string(),
  externalRef: z.string().nullable(),
  exportedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type KamHandoffDetail = z.infer<typeof KamHandoffDetail>;

export const KamHandoffList = z.object({ items: z.array(KamHandoffDetail) });

/**
 * The structured contract ABC's OM section consumes. `schemaVersion` lets ABC
 * evolve the mapping; money is in micros (group convention). This is what an
 * exported handoff hands off — the qualified, sized, client-confirmed lead.
 */
export const KamHandoffPayload = z.object({
  schemaVersion: z.literal(1),
  source: z.literal('bidstack_kam'),
  handoffId: z.string().uuid(),
  exportedAt: z.string(),
  account: z.object({
    companyId: z.string().uuid(),
    name: z.string(),
    country: z.string().nullable(),
  }),
  initiative: z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    ownerId: z.string().uuid().nullable(),
  }),
  opportunity: z
    .object({
      id: z.string().uuid(),
      code: z.string(),
      valueMicros: z.number(),
      currency: z.string(),
    })
    .nullable(),
});
export type KamHandoffPayload = z.infer<typeof KamHandoffPayload>;

export const KamHandoffExportResult = z.object({
  handoff: KamHandoffDetail,
  payload: KamHandoffPayload,
});

/** Confirm a handoff once ABC OM acknowledges it (records the ABC OM id). */
export const KamHandoffConfirmBody = z.object({
  externalRef: z.string().min(1).max(200),
});
