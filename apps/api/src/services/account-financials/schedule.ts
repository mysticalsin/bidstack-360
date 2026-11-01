/**
 * v23: keep one account's financials schedule in step with its gate, right
 * when a tier or Track financials changes (the worker also re-syncs every run).
 */
import { prisma } from '@bidstack/db';
import { financialsEligible } from '@bidstack/shared';

export async function syncAccountFinancialsSchedule(orgId: string, companyId: string, now: Date = new Date()): Promise<'scheduled' | 'paused' | 'unchanged'> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, orgId, deletedAt: null },
    select: { tier: true, topAccountRank: true, trackFinancials: true, financialProfile: { select: { status: true, nextPullAt: true } } },
  });
  if (!c) return 'unchanged';
  const p = c.financialProfile;
  if (financialsEligible(c)) {
    if (!p) {
      await prisma.accountFinancialProfile.create({ data: { orgId, companyId, status: 'pending', nextPullAt: now } });
      return 'scheduled';
    }
    if (p.status === 'paused' || !p.nextPullAt) {
      await prisma.accountFinancialProfile.update({ where: { companyId }, data: { status: 'pending', nextPullAt: now } });
      return 'scheduled';
    }
    return 'unchanged';
  }
  if (p && (p.status !== 'paused' || p.nextPullAt)) {
    await prisma.accountFinancialProfile.update({ where: { companyId }, data: { status: 'paused', nextPullAt: null } });
    return 'paused';
  }
  return 'unchanged';
}
