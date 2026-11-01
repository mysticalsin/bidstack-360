/**
 * v22 helpers shared by the signals and watchdog routes.
 *
 * Sample rows exist so a fresh account is not empty. Once an account has at
 * least one real watchdog row (live news, press feed or provider updates),
 * its sample rows are hidden everywhere so the two never mix.
 */
import { prisma, type Prisma } from '@bidstack/db';

export const LIVE_SIGNAL_SOURCES = ['gdelt', 'google_news', 'company_rss', 'apify_linkedin'] as const;

export async function companiesWithLiveSignals(orgId: string, companyIds: string[]): Promise<string[]> {
  if (!companyIds.length) return [];
  const rows = await prisma.accountWatchEvent.groupBy({
    by: ['companyId'],
    where: { orgId, companyId: { in: companyIds }, sample: false, source: { in: [...LIVE_SIGNAL_SOURCES] } },
  });
  return rows.map((r) => r.companyId);
}

/** Where-clause fragment that drops sample rows for accounts that have real ones. */
export function hideSampleWhere(live: string[]): Prisma.AccountWatchEventWhereInput {
  return live.length ? { NOT: { sample: true, companyId: { in: live } } } : {};
}

const RESERVED = /(^|\.)(example\.(com|org|net)|localhost|invalid|test|example|local|internal)$/i;

/** Same rule as the worker: a real website, or a ticker a person confirmed. */
export function newsIdentifiers(
  domain: string | null | undefined,
  subject: { ticker: string | null; identifiersConfirmedAt: Date | null } | null | undefined,
): { domain: string | null; ticker: string | null; hint: string | null } {
  const d = (domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';
  const okDomain = d && d.includes('.') && !RESERVED.test(d) && !/^\d+(\.\d+){3}$/.test(d) ? d : null;
  const ticker = subject?.identifiersConfirmedAt && subject.ticker ? subject.ticker : null;
  return {
    domain: okDomain,
    ticker,
    hint: okDomain || ticker ? null : 'Add a website or stock ticker to this account to get news.',
  };
}
