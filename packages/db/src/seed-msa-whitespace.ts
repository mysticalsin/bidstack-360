// Demo fixture for slice 13b: a synthetic Pfizer account with a global MSA
// signed via HEMA, a Digital project, and hiring and news signals in IT and
// Engineering. Every row is fake (example domains, "fixture" source) and
// exists so the ranked whitespace view has a clear top flag. Used by both the
// stack seed and the per-visitor demo seed.
import { normalizeName } from '@bidstack/shared';

import type { Prisma, PrismaClient } from '../generated/client/index.js';

type SeedClient = Prisma.TransactionClient | PrismaClient;

export const PFIZER_FIXTURE_NAME = 'Pfizer';

export interface PfizerFixtureIds {
  companyId: string;
  affiliateId: string;
  msaId: string;
}

/** Returns the created ids, or null when the org has no HEMA signing entity. */
export async function seedPfizerWhitespaceFixture(
  prisma: SeedClient,
  orgId: string,
  ownerUserId: string,
  ids?: Partial<PfizerFixtureIds>,
): Promise<PfizerFixtureIds | null> {
  const hema = await prisma.signingEntity.findFirst({ where: { orgId, slug: 'hema', deletedAt: null }, select: { id: true } });
  if (!hema) return null;
  const existing = await prisma.company.findFirst({ where: { orgId, name: PFIZER_FIXTURE_NAME, deletedAt: null }, select: { id: true } });
  if (existing) {
    const msa = await prisma.contractAgreement.findFirst({ where: { orgId, companyId: existing.id, reference: 'PFE-HEMA-GMSA-2024' }, select: { id: true } });
    const child = await prisma.company.findFirst({ where: { orgId, parentId: existing.id }, select: { id: true } });
    if (msa && child) return { companyId: existing.id, affiliateId: child.id, msaId: msa.id };
  }

  const company = await prisma.company.create({
    data: {
      ...(ids?.companyId ? { id: ids.companyId } : {}),
      orgId,
      name: PFIZER_FIXTURE_NAME,
      legalName: 'Pfizer Inc. (demo fixture)',
      domain: 'pfizer-fixture.example',
      website: 'https://pfizer-fixture.example/',
      industry: 'Pharmaceuticals',
      employeeCount: 81_000,
      countryCode: 'US',
      tier: 'key',
      keyAccountOwnerId: ownerUserId,
      keyAccountNotes: 'Demo fixture for MSA whitespace. Synthetic data.',
      source: 'bidstack',
      confidence: 1,
    },
    select: { id: true },
  });
  const affiliate = await prisma.company.create({
    data: {
      ...(ids?.affiliateId ? { id: ids.affiliateId } : {}),
      orgId,
      name: 'Pfizer Ltd (UK)',
      legalName: 'Pfizer Ltd (demo fixture)',
      domain: 'uk.pfizer-fixture.example',
      industry: 'Pharmaceuticals',
      employeeCount: 3_000,
      countryCode: 'GB',
      parentId: company.id,
      source: 'bidstack',
      confidence: 1,
    },
    select: { id: true },
  });

  const msa = await prisma.contractAgreement.create({
    data: {
      ...(ids?.msaId ? { id: ids.msaId } : {}),
      orgId,
      accountKey: normalizeName(PFIZER_FIXTURE_NAME),
      companyId: company.id,
      kind: 'msa',
      title: 'Pfizer global master services agreement',
      reference: 'PFE-HEMA-GMSA-2024',
      counterparty: 'Pfizer Inc.',
      status: 'active',
      countries: ['US', 'GB', 'FR', 'DE', 'BE', 'IE'],
      currency: 'USD',
      rateCard: [
        { role: 'HEOR Consultant', rateMicros: 1_450_000_000, unit: 'day', currency: 'USD' },
        { role: 'Market Access Lead', rateMicros: 1_600_000_000, unit: 'day', currency: 'USD' },
        { role: 'Cloud Data Engineer', rateMicros: 1_200_000_000, unit: 'day', currency: 'USD' },
        { role: 'SAP Consultant', rateMicros: 1_300_000_000, unit: 'day', currency: 'USD' },
        { role: 'Validation Engineer', rateMicros: 1_100_000_000, unit: 'day', currency: 'USD' },
      ],
      effectiveDate: new Date('2024-04-01T00:00:00Z'),
      expiryDate: new Date('2027-03-31T00:00:00Z'),
      autoRenew: false,
      noticePeriodDays: 90,
      governingLaw: 'New York',
      paymentTerms: 'Net 45 days from invoice',
      termMonths: 36,
      scopeOfServices:
        'Supplier and its group companies may provide any services ordered under a Statement of Work worldwide, including health economics, market access, information technology and engineering services.',
      affiliatesClause: 'Affiliates of Client may order services under this Agreement by signing a local Statement of Work.',
      parties: [
        { name: 'Pfizer Inc. (demo fixture)', role: 'client', address: null, email: null },
        { name: 'Amaris Consulting SAS / HEMA', role: 'ours', address: null, email: null },
      ],
      fieldCitations: {
        scopeOfServices: { page: 2, clause: 'Clause 2.1', excerpt: 'any services ordered under a Statement of Work worldwide, including information technology and engineering services' },
        affiliatesClause: { page: 3, clause: 'Clause 4', excerpt: 'Affiliates of Client may order services under this Agreement' },
      },
      signingEntityId: hema.id,
      ownerId: ownerUserId,
      createdById: ownerUserId,
    },
    select: { id: true },
  });

  await prisma.projectReference.create({
    data: {
      orgId,
      accountKey: normalizeName(PFIZER_FIXTURE_NAME),
      companyId: company.id,
      title: 'Patient engagement digital journeys',
      businessSummary: 'Digital patient engagement for two brands in Europe. Demo fixture.',
      status: 'validated',
      sourceSystem: 'fixture',
    },
  });
  await prisma.contact.create({
    data: { orgId, customer: PFIZER_FIXTURE_NAME, companyId: company.id, name: 'Dana Fixture', role: 'Head of Global Procurement' },
  });
  await prisma.activity.create({
    data: {
      orgId,
      type: 'meeting',
      status: 'completed',
      subject: 'HEMA quarterly review',
      entityType: 'company',
      entityId: company.id,
      ownerId: ownerUserId,
      actorType: 'user',
      occurredAt: new Date('2026-10-20T14:00:00Z'),
    },
  });

  const fetchedAt = new Date('2026-11-01T08:00:00Z');
  const postings = [
    { externalId: 'pfe-fx-1', title: 'Senior Cloud Platform Engineer', fn: 'engineering', skills: ['AWS', 'cloud', 'Kubernetes'] },
    { externalId: 'pfe-fx-2', title: 'SAP S/4HANA Lead', fn: 'it', skills: ['SAP', 'S/4HANA'] },
    { externalId: 'pfe-fx-3', title: 'Manufacturing Automation Engineer', fn: 'engineering', skills: ['industrial automation', 'PLC'] },
  ];
  for (const p of postings) {
    await prisma.companyJobPosting.create({
      data: {
        orgId,
        companyId: company.id,
        source: 'fixture',
        externalId: p.externalId,
        title: p.title,
        url: `https://careers.pfizer-fixture.example/jobs/${p.externalId}`,
        country: 'US',
        region: 'AMER',
        function: p.fn,
        seniority: 'senior',
        skills: p.skills,
        postedAt: new Date('2026-10-25T00:00:00Z'),
        fetchedAt,
        sample: true,
      },
    });
  }
  const evidence = await prisma.intelEvidence.create({
    data: {
      orgId,
      companyId: company.id,
      source: 'fixture',
      kind: 'news',
      key: 'pfe-fx-theme',
      label: 'Digital manufacturing investment',
      url: 'https://news.pfizer-fixture.example/digital-manufacturing',
      excerpt: 'Investing in digital manufacturing and a cloud data platform across plants.',
      fetchedAt,
      sample: true,
    },
    select: { id: true },
  });
  await prisma.investmentTheme.create({
    data: {
      orgId,
      companyId: company.id,
      direction: 'investing',
      area: 'manufacturing',
      label: 'Digital manufacturing and cloud data platform',
      basis: 'stated',
      summary: 'Plant automation and a cloud data platform across sites.',
      evidenceIds: [evidence.id],
      computedAt: fetchedAt,
    },
  });
  await prisma.companyPost.create({
    data: {
      orgId,
      companyId: company.id,
      source: 'fixture',
      externalId: 'pfe-fx-news-1',
      url: 'https://news.pfizer-fixture.example/software-hub',
      title: 'Pfizer expands software engineering hub',
      excerpt: 'New software engineering hub for clinical and manufacturing systems. Demo fixture.',
      kind: 'expansion',
      publishedAt: new Date('2026-10-15T00:00:00Z'),
      fetchedAt,
      sample: true,
    },
  });
  return { companyId: company.id, affiliateId: affiliate.id, msaId: msa.id };
}
