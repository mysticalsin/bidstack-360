import { describe, expect, it } from 'vitest';

import {
  classifyContext,
  classifyDomains,
  classifyRelationship,
  composeConsultingPartners,
  ConsultingPartnersSummary,
  DEFAULT_CONSULTING_FIRMS,
  extractRemarks,
  firmCatalog,
  firmMonogram,
  matchFirms,
  namesClient,
  parseFirmList,
  readBidCompetitor,
  readInternalRecord,
  readPublicItem,
  readWinLoss,
  redactContactDetails,
  scorePartner,
  type PartnerEvidence,
  type PartnerEvidenceDraft,
} from '../index.js';

const firms = firmCatalog();
const NOW = new Date('2026-11-07T12:00:00Z');
const RUN = { status: 'ok' as const, lastFetchedAt: NOW.toISOString(), result: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: null };

let seq = 0;
function ev(draft: PartnerEvidenceDraft): PartnerEvidence {
  seq++;
  return {
    id: `e${seq}`,
    firmKey: draft.firmKey,
    firmName: draft.firmName,
    origin: draft.origin,
    source: draft.source,
    sourceLabel: draft.source,
    method: draft.method,
    inferred: draft.inferred,
    url: draft.url,
    recordType: draft.recordType,
    recordId: draft.recordId,
    recordHref: null,
    title: draft.title,
    excerpt: draft.excerpt,
    date: draft.occurredAt?.toISOString() ?? null,
    fetchedAt: NOW.toISOString(),
    relationship: draft.relationship,
    domains: draft.domains,
    context: draft.context,
    sentiment: draft.sentiment,
    remarks: draft.remarks,
    outcome: draft.outcome,
    sample: draft.sample,
  };
}

describe('firm matcher', () => {
  it('finds the default firms by alias, longest alias first', () => {
    const hits = matchFirms('MAHLE extends its Capgemini Engineering contract; Deloitte and PwC audit, EY-Parthenon advises.', firms);
    expect(hits.map((h) => h.firmKey)).toEqual(['capgemini-engineering', 'deloitte', 'pwc', 'ey']);
  });

  it('matches short aliases only with their exact casing so common words never count', () => {
    expect(matchFirms('The key point: ey, bain-marie and alten Kunden', firms)).toEqual([]);
    expect(matchFirms('EY and Bain both pitched; Alten won.', firms).map((h) => h.firmKey)).toEqual(['ey', 'bain', 'alten']);
    expect(matchFirms('kpmg was mentioned in lower case', firms)).toEqual([]);
    expect(matchFirms('accenture in lower case is still Accenture', firms).map((h) => h.firmKey)).toEqual(['accenture', 'accenture']);
  });

  it('extends the catalog from a configurable list and merges known keys', () => {
    const extra = parseFirmList('Tata Consultancy Services|TCS,Tata Consultancy|tcs.com;;KPMG|KPMG Advisory|kpmg.de\n|broken');
    const cat = firmCatalog(extra);
    expect(cat.find((f) => f.key === 'tata-consultancy-services')?.aliases).toContain('TCS');
    expect(cat.find((f) => f.key === 'kpmg')?.domains).toEqual(['kpmg.com', 'kpmg.de']);
    expect(matchFirms('TCS runs the service desk', cat)[0]?.firmKey).toBe('tata-consultancy-services');
    expect(DEFAULT_CONSULTING_FIRMS.map((f) => f.key)).toEqual(
      expect.arrayContaining(['kpmg', 'deloitte', 'pwc', 'ey', 'accenture', 'capgemini', 'ibm-consulting', 'sopra-steria', 'alten', 'akkodis', 'capgemini-engineering', 'cgi', 'atos', 'mckinsey', 'bcg', 'bain']),
    );
  });

  it('monograms and client name matching', () => {
    expect(firmMonogram('KPMG')).toBe('KP');
    expect(firmMonogram('Sopra Steria')).toBe('SS');
    expect(firmMonogram('EY')).toBe('EY');
    expect(namesClient('DNB selects EY as auditor', 'DNB Bank')).toBe(true);
    expect(namesClient('Pfizer and KPMG', 'MAPFRE')).toBe(false);
  });
});

describe('classification', () => {
  it('classifies the relationship type from the announcement wording', () => {
    expect(classifyRelationship('DNB reappoints EY as statutory auditor')).toBe('audit');
    expect(classifyRelationship('MAPFRE and Accenture form a strategic alliance')).toBe('strategic_partner');
    expect(classifyRelationship('MAPFRE selects Accenture to implement SAP S/4HANA')).toBe('implementation');
    expect(classifyRelationship('Akkodis provides engineering services for MAHLE thermal systems')).toBe('engineering');
    expect(classifyRelationship('CGI wins a managed services contract')).toBe('managed_services');
    expect(classifyRelationship('KPMG advises MAPFRE on its data strategy')).toBe('advisory');
    expect(classifyRelationship('MAPFRE posts quarterly results')).toBeNull();
  });

  it('tags domains', () => {
    expect(classifyDomains('SAP S/4HANA move to Azure cloud with a data and AI platform')).toEqual(['sap', 'cloud', 'data']);
    expect(classifyDomains('Clinical trial regulatory affairs for a pharma major')).toEqual(['hema_pharma']);
    expect(classifyDomains('Embedded software for e-mobility powertrain')).toEqual(['engineering']);
    expect(classifyDomains('SOC build-out and zero trust')).toEqual(['cyber']);
    expect(classifyDomains('Said hello to the team')).toEqual([]);
  });

  it('reads context from internal text', () => {
    expect(classifyContext('KPMG is the incumbent on the audit')).toBe('incumbent');
    expect(classifyContext('We are up against Accenture on the RFP')).toBe('competing');
    expect(classifyContext('The client said Accenture was slow')).toBe('client_feedback');
    expect(classifyContext('Lunch with someone who used to work at KPMG')).toBe('mention');
  });
});

describe('remarks', () => {
  it('assigns the remark to whoever is the subject of the comparison', () => {
    expect(extractRemarks('We were faster than KPMG on the SAP rollout.', 'kpmg', firms)).toEqual([
      expect.objectContaining({ dimension: 'speed', favours: 'us' }),
    ]);
    expect(extractRemarks('KPMG was cheaper than us on the advisory lot.', 'kpmg', firms)).toEqual([
      expect.objectContaining({ dimension: 'price', favours: 'partner' }),
    ]);
    expect(extractRemarks('The client said Accenture delivery was poor and slow.', 'accenture', firms).map((r) => [r.dimension, r.favours])).toEqual([
      ['quality', 'us'],
      ['speed', 'us'],
    ]);
    expect(extractRemarks('We lost to Accenture on price.', 'accenture', firms)).toEqual([
      expect.objectContaining({ dimension: 'price', favours: 'partner' }),
    ]);
  });

  it('ignores sentences without the firm, without a dimension or without polarity', () => {
    expect(extractRemarks('Price was better. Accenture joined the call.', 'accenture', firms)).toEqual([]);
    expect(extractRemarks('Accenture presented their pricing.', 'accenture', firms)).toEqual([]);
    expect(extractRemarks('KPMG was faster than Deloitte.', 'kpmg', firms)).toEqual([]);
  });
});

describe('evidence drafts', () => {
  it('a public item must name the client and carry a relationship word unless it is on the firm site', () => {
    const news = readPublicItem({ source: 'google_news', url: 'https://news.example/a', title: 'MAPFRE selects Accenture for SAP S/4HANA rollout', description: '', publishedAt: NOW }, 'MAPFRE', firms);
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({ firmKey: 'accenture', relationship: 'implementation', inferred: false, origin: 'public', url: 'https://news.example/a', domains: ['sap'] });
    expect(readPublicItem({ source: 'gdelt', url: 'https://news.example/b', title: 'Accenture posts results', description: 'Strong quarter', publishedAt: NOW }, 'MAPFRE', firms)).toEqual([]);
    expect(readPublicItem({ source: 'gdelt', url: 'https://news.example/c', title: 'MAPFRE and Accenture at a conference', description: '', publishedAt: NOW }, 'MAPFRE', firms)).toEqual([]);
    const site = readPublicItem({ source: 'google_news', url: 'https://www.kpmg.com/case/mapfre', title: 'MAPFRE data office', description: '', publishedAt: NOW }, 'MAPFRE', firms);
    expect(site[0]).toMatchObject({ firmKey: 'kpmg', source: 'firm_site', inferred: true, relationship: null });
  });

  it('internal records cite the record id and carry context, sentiment and remarks', () => {
    const [d] = readInternalRecord({ source: 'note', recordType: 'note', recordId: 'n1', title: 'QBR', text: 'Client feedback: we delivered better quality than Accenture on the claims app.', occurredAt: NOW }, firms);
    expect(d).toMatchObject({ firmKey: 'accenture', origin: 'internal', recordType: 'note', recordId: 'n1', url: null, context: 'client_feedback', sentiment: 'negative', remarks: [expect.objectContaining({ dimension: 'quality', favours: 'us' })] });
    expect(d!.excerpt).toContain('better quality than Accenture');
  });

  it('excerpts never carry email addresses or phone numbers', () => {
    const [d] = readInternalRecord({ source: 'email', recordType: 'email', recordId: 'm1', title: null, text: 'Ana at KPMG (ana.lopez@kpmg.com, +34 600 123 456) says KPMG is the incumbent.', occurredAt: NOW }, firms);
    expect(d!.excerpt).not.toMatch(/@|600 123/);
    expect(d!.excerpt).toContain('[email removed]');
  });

  it('win/loss and bid competitor fields turn into outcome and remarks', () => {
    const [w] = readWinLoss({ id: 'w1', opportunityId: 'o1', opportunityName: 'Cloud move', outcome: 'won', reason: 'price', competitor: 'KPMG', note: null, decidedAt: NOW }, firms);
    expect(w).toMatchObject({ firmKey: 'kpmg', outcome: 'won', method: 'record_field', opportunityId: 'o1', remarks: [{ dimension: 'price', favours: 'us', phrase: 'Won on price' }] });
    const [b] = readBidCompetitor({ opportunityId: 'o2', opportunityName: 'SOC', vendor: 'Accenture', score: 72, strengths: ['Scale', 'Brand'], weaknesses: ['Cost'], at: NOW }, firms);
    expect(b!.remarks).toEqual([{ dimension: 'price', favours: 'us', phrase: 'Weakness: Cost' }]);
  });
});

describe('positioning math', () => {
  it('shows no evidence, not a guess, when nothing speaks to a dimension', () => {
    const card = scorePartner([], { won: 0, open: 0 });
    expect(card.map((d) => d.dimension)).toEqual(['quality', 'price', 'speed', 'domain', 'relationship']);
    for (const d of card) expect(d).toEqual({ dimension: d.dimension, status: 'no_evidence', us: null, partner: null, evidenceCount: 0, evidenceIds: [] });
  });

  it('scores each dimension from the share of cited records that favour us', () => {
    const items = [
      ev({ ...readWinLoss({ id: 'w1', opportunityId: 'o1', opportunityName: 'A', outcome: 'won', reason: 'price', competitor: 'KPMG', note: null, decidedAt: NOW }, firms)[0]! }),
      ev({ ...readWinLoss({ id: 'w2', opportunityId: 'o2', opportunityName: 'B', outcome: 'won', reason: 'price', competitor: 'KPMG', note: null, decidedAt: NOW }, firms)[0]! }),
      ev({ ...readWinLoss({ id: 'w3', opportunityId: 'o3', opportunityName: 'C', outcome: 'lost', reason: 'price', competitor: 'KPMG', note: null, decidedAt: NOW }, firms)[0]! }),
      ev(readPublicItem({ source: 'gdelt', url: 'https://n/1', title: 'MAPFRE appoints KPMG as auditor', description: '', publishedAt: NOW }, 'MAPFRE', firms)[0]!),
    ];
    const card = scorePartner(items, { won: 2, open: 1 });
    const price = card.find((d) => d.dimension === 'price')!;
    expect(price).toMatchObject({ status: 'scored', us: 67, partner: 33, evidenceCount: 3 });
    expect(card.find((d) => d.dimension === 'quality')).toMatchObject({ status: 'no_evidence', us: null });
    expect(card.find((d) => d.dimension === 'relationship')).toMatchObject({ status: 'scored', us: 75, partner: 25, evidenceCount: 4, evidenceIds: [items[3]!.id] });
  });

  it('composes cards with strength, record and cited angles only', () => {
    const items = [
      ev(readPublicItem({ source: 'google_news', url: 'https://n/1', title: 'MAPFRE appoints KPMG as auditor', description: '', publishedAt: new Date('2025-03-01') }, 'MAPFRE', firms)[0]!),
      ev(readPublicItem({ source: 'google_news', url: 'https://n/2', title: 'KPMG advises MAPFRE on its data strategy', description: '', publishedAt: new Date('2026-05-01') }, 'MAPFRE', firms)[0]!),
      ...['w1', 'w2', 'w3'].map((id) => ev(readWinLoss({ id, opportunityId: id, opportunityName: 'Engineering lot', outcome: 'won', reason: 'product_fit', competitor: 'KPMG', note: null, decidedAt: new Date('2025-06-01') }, firms)[0]!)),
      ev(readWinLoss({ id: 'w4', opportunityId: 'w4', opportunityName: 'Advisory lot', outcome: 'lost', reason: 'relationship', competitor: 'KPMG', note: null, decidedAt: new Date('2025-09-01') }, firms)[0]!),
      ev(readInternalRecord({ source: 'note', recordType: 'note', recordId: 'n1', title: null, text: 'Accenture was mentioned once.', occurredAt: new Date('2024-01-01') }, firms)[0]!),
    ];
    const summary = ConsultingPartnersSummary.parse(
      composeConsultingPartners({ companyId: 'c1', clientName: 'MAPFRE', firms, evidence: items, engagements: { won: 1, open: 0 }, run: RUN, now: NOW }),
    );
    expect(summary.partners.map((p) => p.firmKey)).toEqual(['kpmg', 'accenture']);
    const kpmg = summary.partners[0]!;
    expect(kpmg.relationships).toEqual(['advisory', 'audit']);
    expect(kpmg.record).toEqual({ wins: 3, losses: 1, firstYear: 2025, lastYear: 2025 });
    expect(kpmg.angles.map((a) => a.text)).toEqual([
      'KPMG works on advisory and audit at MAPFRE in Data, 2 public sources since 2025.',
      '3 wins vs 1 loss against KPMG in 2025.',
      'We lead KPMG on domain depth: 3 of 3 cited records favour us.',
    ]);
    const ids = new Set(items.map((e) => e.id));
    for (const a of kpmg.angles) for (const id of a.evidenceIds) expect(ids.has(id)).toBe(true);
    const accenture = summary.partners[1]!;
    expect(accenture.angles).toEqual([]);
    expect(accenture.scorecard.filter((d) => d.status === 'no_evidence').map((d) => d.dimension)).toEqual(['quality', 'price', 'speed', 'domain', 'relationship']);
    expect(accenture.strength.level).toBe('weak');
    expect(JSON.stringify(summary)).not.toContain('\u2014');
  });
});

describe('contact details and evidence-only scores', () => {
  it('redacts emails and phone numbers everywhere text is stored, but keeps dates and amounts', () => {
    expect(redactContactDetails('Call +47 915 55 123 or 0612345678 on 2026-03-01 about 1 200 000 EUR')).toBe('Call [phone removed] or [phone removed] on 2026-03-01 about 1 200 000 EUR');
    const [note] = readInternalRecord({ source: 'note', recordType: 'note', recordId: 'n9', title: 'From ana@client.example', text: 'Our quality is better than KPMG, ask ana@client.example or +34 600 123 456.', occurredAt: NOW }, firms);
    expect(JSON.stringify(note)).not.toMatch(/@client|600 123/);
    const [wl] = readWinLoss({ id: 'w9', opportunityId: 'o9', opportunityName: 'Lot', outcome: 'lost', reason: 'price', competitor: 'KPMG', note: 'Buyer bob@buyer.example said KPMG was cheaper', decidedAt: NOW }, firms);
    expect(JSON.stringify(wl)).not.toContain('bob@buyer.example');
    const [bid] = readBidCompetitor({ opportunityId: 'o9', opportunityName: 'Lot', vendor: 'KPMG', score: 70, strengths: ['Cheap rates, see +44 20 7946 0958'], weaknesses: [], at: NOW }, firms);
    expect(JSON.stringify(bid)).not.toContain('7946');
  });

  it('never reads LinkedIn items', () => {
    const item = { source: 'gdelt' as const, url: 'https://www.linkedin.com/posts/x', title: 'MAPFRE selects KPMG for advisory', description: '', publishedAt: NOW };
    expect(readPublicItem(item, 'MAPFRE', firms)).toEqual([]);
  });

  it('relationship has no evidence when nothing cites the partner side, even with our own deals', () => {
    const [note] = readInternalRecord({ source: 'note', recordType: 'note', recordId: 'n10', title: null, text: 'Our quality is better than KPMG.', occurredAt: NOW }, firms);
    const rel = scorePartner([ev(note!)], { won: 4, open: 2 }).find((d) => d.dimension === 'relationship');
    expect(rel).toMatchObject({ status: 'no_evidence', us: null, partner: null, evidenceIds: [] });
  });
});
