/**
 * kam-account.ts — designate + switch a Key Account (swarm spec).
 *
 * "Is a key account" = Company.kamStatus != 'identified'. `identified` = a
 * candidate; promoting it off `identified` IS the act of designation (stamps
 * keyAccountSince write-once). Separate from the legacy `tier='key'` CRM concept.
 */
import { z } from 'zod';

export const KAM_ACCOUNT_STATUSES = [
  'identified',
  'kickoff',
  'mapped',
  'active',
  'paused',
  'closed',
] as const;
export const KAM_OWNER_MODELS = ['presales_driven', 'manager_driven'] as const;

// Response schemas are lenient (no length constraints) so odd existing data
// can't trip response validation.
export const KamAccount = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  countryCode: z.string().nullable(),
  industry: z.string().nullable(),
  kamStatus: z.enum(KAM_ACCOUNT_STATUSES),
  kamOwnerModel: z.enum(KAM_OWNER_MODELS).nullable(),
  directorSponsorId: z.string().uuid().nullable(),
  keyAccountOwnerId: z.string().uuid().nullable(),
  keyAccountSince: z.string().nullable(),
});
export type KamAccount = z.infer<typeof KamAccount>;

export const KamAccountList = z.object({ items: z.array(KamAccount) });
export type KamAccountList = z.infer<typeof KamAccountList>;

export const KamAccountCandidate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  industry: z.string().nullable(),
  countryCode: z.string().nullable(),
});
export const KamAccountCandidateList = z.object({ items: z.array(KamAccountCandidate) });
export type KamAccountCandidateList = z.infer<typeof KamAccountCandidateList>;

/** Designate / re-designate / update KAM fields. At least one field required. */
export const KamAccountDesignatePatch = z
  .object({
    kamStatus: z.enum(KAM_ACCOUNT_STATUSES).optional(),
    kamOwnerModel: z.enum(KAM_OWNER_MODELS).nullable().optional(),
    directorSponsorId: z.string().uuid().nullable().optional(),
    keyAccountOwnerId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type KamAccountDesignatePatch = z.infer<typeof KamAccountDesignatePatch>;
