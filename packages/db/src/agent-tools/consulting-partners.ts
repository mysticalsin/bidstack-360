/**
 * consulting_partners tool (slice 15), read only, shared by the MCP server
 * and Jarvis.
 *
 * Public evidence is open to any caller with account-intel:read. Internal
 * evidence (our notes, meetings, emails, activities, win/loss and bid fields)
 * is only included for a signed-in Jarvis user, and only for records that
 * user authored, owns or attended, and our deal counts only cover deals that
 * user owns. MCP API keys get public evidence only and no deal counts.
 * Every angle and score cites evidence ids returned in the same answer.
 */
import { z } from 'zod';

import { composeConsultingPartners, FirmKey } from '@bidstack/shared';

import {
  countPartnerEngagements,
  isInternalPartnerRow,
  loadOrgFirmCatalog,
  loadPartnerEvidenceRows,
  loadPartnerRun,
  ownedPartnerRowIds,
  toPartnerEvidence,
} from '../consulting-partners.js';
import { prisma } from '../index.js';

import type { AgentCitation, AgentTool } from './types.js';

const MAX_PARTNERS = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE = 'Scores and angles cite evidence ids listed under evidence. A dimension with no evidence shows no_evidence, not a guess. Lines marked inferred are derived by rules.';

const Input = z
  .object({
    companyId: z.string().uuid().optional(),
    companyName: z.string().min(1).max(200).optional(),
    firm: FirmKey.optional(),
    limit: z.number().int().min(1).max(MAX_PARTNERS).default(6),
  })
  .refine((v) => Boolean(v.companyId || v.companyName), { message: 'companyId or companyName is required' });

function stripMarkup(value: string): string {
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 32 || c === 9 || c === 10 || c === 13;
    })
    .join('')
    .trim();
}

function clean<T>(value: T): T {
  if (typeof value === 'string') return stripMarkup(value) as T;
  if (Array.isArray(value)) return value.map((v) => clean(v)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) as T;
  return value;
}

/** consulting_partners: who the client works with and how we position against each firm. */
export const consultingPartners = {
  description:
    'Consulting firms that work with an account (for example KPMG, Accenture, Capgemini) with relationship type, domains, first and last seen, strength, a cited us vs partner score card (quality, price, speed, domain depth, relationship) and 1 to 3 cited positioning angles.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      companyName: { type: 'string', minLength: 1, maxLength: 200 },
      firm: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
      limit: { type: 'integer', minimum: 1, maximum: MAX_PARTNERS },
    },
    additionalProperties: false,
  },
  kind: 'read',
  permission: 'account-intel:read',
  async handler(args, ctx) {
    const company = await prisma.company.findFirst({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        ...(args.companyId ? { id: args.companyId } : { name: { equals: args.companyName ?? '', mode: 'insensitive' as const } }),
      },
      select: { id: true, name: true },
    });
    if (!company) throw new Error('Account not found');
    const rows = await loadPartnerEvidenceRows(prisma, ctx.orgId, company.id);
    const userId = ctx.surface === 'jarvis' && ctx.userId && UUID_RE.test(ctx.userId) ? ctx.userId : null;
    const owned = userId ? await ownedPartnerRowIds(prisma, ctx.orgId, userId, rows.filter(isInternalPartnerRow)) : new Set<string>();
    const visible = rows.filter((r) => !isInternalPartnerRow(r) || owned.has(r.id)).filter((r) => !args.firm || r.firmKey === args.firm);
    const [firms, engagements, run] = await Promise.all([
      loadOrgFirmCatalog(prisma, ctx.orgId, process.env.CONSULTING_PARTNER_FIRMS),
      userId ? countPartnerEngagements(prisma, ctx.orgId, company.id, { ownerId: userId }) : Promise.resolve({ won: 0, open: 0 }),
      loadPartnerRun(prisma, ctx.orgId, company.id),
    ]);
    const evidence = visible.map(toPartnerEvidence);
    const summary = composeConsultingPartners({ companyId: company.id, clientName: company.name, firms, evidence, engagements, run, now: new Date() });
    const partners = summary.partners.slice(0, Math.max(1, Math.min(MAX_PARTNERS, Number(args.limit ?? 6))));
    const cited = new Set(partners.flatMap((p) => [...p.angles.flatMap((a) => a.evidenceIds), ...p.scorecard.flatMap((d) => d.evidenceIds)]));
    const citations: AgentCitation[] = [{ kind: 'account', label: company.name, href: `/accounts/${company.id}` }];
    return clean({
      account: company.name,
      partners: partners.map(({ timeline: _timeline, ...p }) => p),
      evidence: evidence
        .filter((e) => cited.has(e.id))
        .slice(0, 50)
        .map((e) => ({ id: e.id, firm: e.firmName, origin: e.origin, source: e.sourceLabel, url: e.url, recordHref: e.recordHref, date: e.date, excerpt: e.excerpt, method: e.method, inferred: e.inferred })),
      lastFetchedAt: run.lastFetchedAt,
      sample: summary.sample,
      note: NOTE,
      citations,
    });
  },
} satisfies AgentTool<typeof Input>;
