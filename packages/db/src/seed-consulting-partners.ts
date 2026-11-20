/**
 * Slice 15 demo fixtures: consulting partners for the seeded demo accounts.
 * Public rows are source 'fixture', method 'fixture', sample=true, and run
 * through the same reader as fetched news. Internal evidence comes from
 * Sample-titled notes that the regular internal scan reads; their rows are
 * flagged sample too. Idempotent: notes are matched by title, rows upsert on
 * their keys.
 */
import { DEFAULT_CONSULTING_FIRMS, type PartnerEvidenceDraft, type PartnerPublicItem, readPublicItem } from '@bidstack/shared';

import { savePartnerEvidence, scanInternalPartnerEvidence } from './consulting-partners.js';
import type { PrismaClient } from '../generated/client/index.js';

const DAY = 86_400_000;

interface FixtureItem {
  title: string;
  daysAgo: number;
  site: string;
}
interface FixtureNote {
  title: string;
  body: string;
  daysAgo: number;
}
interface PartnerFixture {
  account: string;
  items: FixtureItem[];
  notes: FixtureNote[];
}

/** Clearly fictional sample stories; the UI shows them with the Sample tag. */
export const PARTNER_FIXTURES: PartnerFixture[] = [
  {
    account: 'MAPFRE',
    items: [
      { title: 'KPMG advises MAPFRE on its finance and risk programme', daysAgo: 40, site: 'https://kpmg.com/' },
      { title: 'MAPFRE extends Accenture managed services for core insurance IT', daysAgo: 120, site: 'https://www.accenture.com/' },
      { title: 'MAPFRE and Accenture expand cloud alliance', daysAgo: 400, site: 'https://www.accenture.com/' },
    ],
    notes: [
      {
        title: 'Sample: MAPFRE IT steering debrief',
        body: 'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform. Our squads were faster to staff than Accenture.',
        daysAgo: 20,
      },
    ],
  },
  {
    account: 'DNB Bank',
    items: [
      { title: 'EY reappointed as statutory auditor of DNB Bank', daysAgo: 90, site: 'https://www.ey.com/' },
      { title: 'DNB Bank selects Sopra Steria to implement its cloud data platform', daysAgo: 60, site: 'https://www.soprasteria.com/' },
    ],
    notes: [
      {
        title: 'Sample: DNB procurement feedback',
        body: 'DNB procurement feedback: Sopra Steria is cheaper than us. Our data engineering quality is stronger than Sopra Steria.',
        daysAgo: 15,
      },
    ],
  },
  {
    account: 'MAHLE',
    items: [{ title: 'MAHLE partners with Akkodis on e-mobility engineering services', daysAgo: 75, site: 'https://www.akkodis.com/' }],
    notes: [
      {
        title: 'Sample: MAHLE test bench review',
        body: 'Akkodis was slow to ramp up the validation team. Our engineers delivered faster than Akkodis on the thermal test bench.',
        daysAgo: 10,
      },
    ],
  },
];

/** Public fixture drafts for one account, read like fetched news. */
export function partnerFixtureDrafts(f: PartnerFixture, now: Date): PartnerEvidenceDraft[] {
  return f.items.flatMap((it) => {
    const item: PartnerPublicItem = { source: 'fixture', url: it.site, title: it.title, description: '', publishedAt: new Date(now.getTime() - it.daysAgo * DAY), host: 'fixture.invalid' };
    return readPublicItem(item, f.account, DEFAULT_CONSULTING_FIRMS).map((d) => ({ ...d, key: `fixture:${d.key}` }));
  });
}

/** Seed sample consulting partners for the demo accounts. Returns rows written. */
export async function seedConsultingPartners(prisma: PrismaClient, orgId: string, now: Date = new Date()): Promise<number> {
  const author = await prisma.user.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  let written = 0;
  for (const f of PARTNER_FIXTURES) {
    const company = await prisma.company.findFirst({ where: { orgId, name: f.account, deletedAt: null }, select: { id: true } });
    if (!company) continue;
    const companyId = company.id;
    const sampleNotes = new Set<string>();
    if (author) {
      for (const n of f.notes) {
        const existing = await prisma.note.findFirst({ where: { orgId, companyId, title: n.title, deletedAt: null }, select: { id: true } });
        const createdAt = new Date(now.getTime() - n.daysAgo * DAY);
        const note = existing
          ? await prisma.note.update({ where: { id: existing.id }, data: { bodyMd: n.body }, select: { id: true } })
          : await prisma.note.create({ data: { orgId, accountId: companyId, companyId, authorUserId: author.id, title: n.title, bodyMd: n.body, createdAt }, select: { id: true } });
        sampleNotes.add(note.id);
      }
    }
    const internal = (await scanInternalPartnerEvidence(prisma, { orgId, companyId, firms: DEFAULT_CONSULTING_FIRMS, now })).map((d) =>
      d.recordId && sampleNotes.has(d.recordId) ? { ...d, sample: true } : d,
    );
    const drafts = [...partnerFixtureDrafts(f, now), ...internal];
    const saved = await savePartnerEvidence(prisma, { orgId, companyId, drafts, now, replaceInternal: true });
    written += saved.new + saved.updated;
    await prisma.consultingPartnerRun.upsert({
      where: { orgId_companyId: { orgId, companyId } },
      create: { orgId, companyId, status: 'ok', lastFetchedAt: new Date(now.getTime() - DAY), result: { new: saved.new, updated: saved.updated, skipped: 0, failed: 0 } },
      update: {},
    });
  }
  return written;
}
