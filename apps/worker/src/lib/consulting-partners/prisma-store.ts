/** Prisma-backed store for the consulting partners scan (slice 15). */
import { type Prisma, loadOrgFirmCatalog, prisma, savePartnerEvidence, scanInternalPartnerEvidence } from '@bidstack/db';
import type { PartnerPublicItem } from '@bidstack/shared';

import { completeChat, resolveLlmFromEnv, type ResolvedLlm } from '../llm-provider.js';
import { resolveOrgLlm } from '../org-llm.js';
import type { PartnerLlm, PartnerStore } from './run.js';

const DAY = 86_400_000;
const STORED_DAYS = 3 * 365;
const STORED_TAKE = 300;

/** Production store. */
export function prismaPartnerStore(env: Record<string, string | undefined> = process.env): PartnerStore {
  return {
    async subject(orgId, companyId) {
      const c = await prisma.company.findFirst({ where: { id: companyId, orgId, deletedAt: null }, select: { id: true, name: true } });
      return c ? { orgId, companyId: c.id, companyName: c.name } : null;
    },
    firms: (orgId) => loadOrgFirmCatalog(prisma, orgId, env.CONSULTING_PARTNER_FIRMS),
    async storedItems(orgId, companyId) {
      const since = new Date(Date.now() - STORED_DAYS * DAY);
      const [posts, events] = await Promise.all([
        prisma.companyPost.findMany({
          where: { orgId, companyId, sample: false, fetchedAt: { gte: since } },
          select: { url: true, title: true, excerpt: true, publishedAt: true },
          orderBy: { fetchedAt: 'desc' },
          take: STORED_TAKE,
        }),
        prisma.accountWatchEvent.findMany({
          where: { orgId, companyId, occurredAt: { gte: since } },
          select: { sourceUrl: true, title: true, summary: true, occurredAt: true },
          orderBy: { occurredAt: 'desc' },
          take: STORED_TAKE,
        }),
      ]);
      const items: PartnerPublicItem[] = [
        ...posts.map((p) => ({ source: 'company_newsroom' as const, url: p.url, title: p.title, description: p.excerpt, publishedAt: p.publishedAt })),
        ...events.map((e) => ({ source: 'account_news' as const, url: e.sourceUrl, title: e.title, description: e.summary, publishedAt: e.occurredAt })),
      ];
      return items;
    },
    internal: (orgId, companyId, firms) => scanInternalPartnerEvidence(prisma, { orgId, companyId, firms }),
    save: (orgId, companyId, drafts, now) => savePartnerEvidence(prisma, { orgId, companyId, drafts, now, replaceInternal: true }),
    async setRun(orgId, companyId, run) {
      const data = {
        status: run.status,
        ...(run.lastFetchedAt !== undefined ? { lastFetchedAt: run.lastFetchedAt } : {}),
        ...(run.result ? { result: run.result as unknown as Prisma.InputJsonValue } : {}),
        ...(run.detail !== undefined ? { detail: run.detail } : {}),
      };
      await prisma.consultingPartnerRun.upsert({ where: { orgId_companyId: { orgId, companyId } }, create: { orgId, companyId, ...data }, update: data });
    },
  };
}

/** The org's LLM (or the env one) for the optional remark pass, null when none is configured. */
export async function partnerLlm(orgId: string): Promise<PartnerLlm | null> {
  let llm: ResolvedLlm | null;
  try {
    llm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();
  } catch {
    llm = null;
  }
  if (!llm) return null;
  const resolved = llm;
  return ({ system, user }) => completeChat(resolved, { system, user, responseFormat: 'json_object', maxTokens: 600, timeoutMs: 30_000 });
}
