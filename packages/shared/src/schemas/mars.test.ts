import { describe, expect, it } from 'vitest';

import {
  dedupePeople,
  inferReportingLines,
  isMarsEnabled,
  MARS_TOOLS,
  type MarsAccountCandidate,
  MarsEntry,
  MarsToolInputs,
  matchMarsAccount,
  meetingRecency,
  normalizeCompanyName,
  normalizeDomain,
  normalizeLinkedinHandle,
  type PersonSighting,
} from './mars.js';

const acc = (companyId: string, name: string, extra: Partial<MarsAccountCandidate> = {}): MarsAccountCandidate => ({
  companyId,
  name,
  legalName: null,
  domain: null,
  parentId: null,
  ...extra,
});

describe('isMarsEnabled', () => {
  it('is off unless explicitly on', () => {
    expect(isMarsEnabled(undefined)).toBe(false);
    expect(isMarsEnabled('')).toBe(false);
    expect(isMarsEnabled('no')).toBe(false);
    expect(isMarsEnabled('true')).toBe(true);
    expect(isMarsEnabled('1')).toBe(false);
    expect(isMarsEnabled(' TRUE ')).toBe(true);
  });
});

describe('normalizers', () => {
  it('strips legal suffixes and punctuation', () => {
    expect(normalizeCompanyName('Northwind Energy S.A.S.')).toBe(normalizeCompanyName('northwind energy'));
    expect(normalizeCompanyName('Example Corp')).not.toBe(normalizeCompanyName('Example Staffing'));
  });
  it('normalizes domains and rejects junk', () => {
    expect(normalizeDomain('https://www.Northwind-Energy.example/about')).toBe('northwind-energy.example');
    expect(normalizeDomain('not a domain')).toBeNull();
  });
  it('extracts LinkedIn handles', () => {
    expect(normalizeLinkedinHandle('https://www.linkedin.com/in/Lukas-Brandt/?utm=x')).toBe('lukas-brandt');
    expect(normalizeLinkedinHandle('https://example.com/in/x')).toBeNull();
  });
});

describe('matchMarsAccount', () => {
  const accounts = [
    acc('a1', 'Example Corp', { domain: 'example.com', legalName: 'Example Corporation Inc' }),
    acc('a2', 'Example Staffing', { domain: 'examplestaffing.com' }),
    acc('a3', 'Northwind Energy', { domain: 'northwind-energy.example' }),
    acc('a4', 'Acme', { domain: 'acme.example' }),
    acc('a5', 'Acme', { domain: 'acme-group.example' }),
    acc('a6', 'Mapped Co', { marsAccountId: 'M-77' }),
  ];

  it('prefers a confirmed MARS id', () => {
    expect(matchMarsAccount({ name: 'whatever', marsAccountId: 'M-77' }, accounts)).toEqual({ companyId: 'a6', method: 'mars_id' });
  });
  it('matches exact domain, then subdomain at a label boundary', () => {
    expect(matchMarsAccount({ name: 'X', domain: 'example.com' }, accounts)).toMatchObject({ companyId: 'a1', method: 'domain' });
    expect(matchMarsAccount({ name: 'X', domain: 'fr.example.com' }, accounts)).toMatchObject({ companyId: 'a1', method: 'domain' });
    // not a substring match: "badexample.com" is not example.com
    expect(matchMarsAccount({ name: 'X', domain: 'badexample.com' }, accounts)).toMatchObject({ companyId: null, reason: 'no_match' });
  });
  it('never matches by substring of the name', () => {
    // legal suffixes are ignored, but a partial name never matches
    expect(matchMarsAccount({ name: 'Example' }, accounts)).toMatchObject({ companyId: 'a1', method: 'name' });
    expect(matchMarsAccount({ name: 'Exampl' }, accounts).companyId).toBeNull();
    expect(matchMarsAccount({ name: 'Example Staffing' }, accounts)).toMatchObject({ companyId: 'a2', method: 'name' });
    expect(matchMarsAccount({ name: 'Example Staffing Partners' }, accounts).companyId).toBeNull();
  });
  it('matches legal name', () => {
    expect(matchMarsAccount({ name: 'EC', legalName: 'Example Corporation, Inc.' }, accounts)).toMatchObject({ companyId: 'a1', method: 'legal_name' });
  });
  it('reports ambiguity instead of guessing', () => {
    const r = matchMarsAccount({ name: 'Acme' }, accounts);
    expect(r).toMatchObject({ companyId: null, reason: 'ambiguous' });
    if (r.companyId === null) expect(r.candidates.sort()).toEqual(['a4', 'a5']);
  });
  it('uses client contact email domains, ignoring free mail and our own domain', () => {
    expect(matchMarsAccount({ name: 'Unknown SAS' }, accounts, { contactEmails: ['a@northwind-energy.example'] })).toMatchObject({ companyId: 'a3', method: 'contact_domain' });
    expect(matchMarsAccount({ name: 'Unknown SAS' }, accounts, { contactEmails: ['a@gmail.com'] }).companyId).toBeNull();
    expect(matchMarsAccount({ name: 'Unknown SAS' }, accounts, { contactEmails: ['me@example.com'], ownDomains: new Set(['example.com']) }).companyId).toBeNull();
  });
  it('falls back to the parent company', () => {
    expect(matchMarsAccount({ name: 'Northwind France', parentName: 'Northwind Energy' }, accounts)).toMatchObject({ companyId: 'a3', method: 'parent' });
  });
});

const s = (p: Partial<PersonSighting> & { name: string }): PersonSighting => ({ companyId: 'c1', seenAt: '2026-10-01T10:00:00.000Z', ...p });

describe('dedupePeople', () => {
  it('merges by email and by LinkedIn, transitively', () => {
    const out = dedupePeople([
      s({ name: 'Lukas Brandt', email: 'lukas@nw.example', linkedinUrl: 'https://linkedin.com/in/lukas-brandt', title: 'VP Data', meetingRef: 'm1' }),
      s({ name: 'L. Brandt', linkedinUrl: 'https://www.linkedin.com/in/Lukas-Brandt/', title: 'SVP Data', seenAt: '2026-10-20T10:00:00.000Z', meetingRef: 'm2' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'email:lukas@nw.example', name: 'Lukas Brandt', title: 'SVP Data', meetingCount: 2, firstMetAt: '2026-10-01T10:00:00.000Z', lastMetAt: '2026-10-20T10:00:00.000Z' });
  });
  it('joins a name-only sighting to a unique same-company name group', () => {
    const out = dedupePeople([s({ name: 'Sofia Ricci', email: 'sofia@nw.example', meetingRef: 'm1' }), s({ name: 'sofia  ricci', meetingRef: 'm2' })]);
    expect(out).toHaveLength(1);
  });
  it('keeps two people with the same name apart when the name is ambiguous', () => {
    const out = dedupePeople([
      s({ name: 'John Smith', email: 'john1@nw.example' }),
      s({ name: 'John Smith', email: 'john2@nw.example' }),
      s({ name: 'John Smith' }),
    ]);
    expect(out).toHaveLength(3);
  });
  it('never merges across companies by name', () => {
    expect(dedupePeople([s({ name: 'Ana Lopez', email: 'ana@a.example' }), s({ name: 'Ana Lopez', companyId: 'c2' })])).toHaveLength(2);
  });
});

describe('meetingRecency', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  it('buckets by days since last meeting', () => {
    expect(meetingRecency(null, now)).toBe('never');
    expect(meetingRecency('2026-10-20T00:00:00.000Z', now)).toBe('recent');
    expect(meetingRecency('2026-10-01T12:00:00.000Z', now)).toBe('recent');
    expect(meetingRecency('2026-09-15T00:00:00.000Z', now)).toBe('warm');
    expect(meetingRecency('2026-06-01T00:00:00.000Z', now)).toBe('stale');
    expect(meetingRecency('garbage', now)).toBe('never');
  });
});

describe('inferReportingLines', () => {
  const people = dedupePeople([
    s({ name: 'Helen Marsh', email: 'helen@nw.example', title: 'Chief Executive Officer', meetingRef: 'm1' }),
    s({ name: 'Omar Haddad', email: 'omar@nw.example', title: 'CFO', meetingRef: 'm1' }),
    s({ name: 'Priya Natarajan', email: 'priya@nw.example', title: 'CIO', meetingRef: 'm2' }),
    s({ name: 'Lukas Brandt', email: 'lukas@nw.example', title: 'VP Data', meetingRef: 'm2' }),
    s({ name: 'Sofia Ricci', title: 'Data Engineer', meetingRef: 'm3', reportsTo: { name: 'Priya Natarajan' } }),
  ]);

  it('suggests plausible lines and never a junior manager', () => {
    const out = inferReportingLines({ people });
    const by = new Map(out.map((o) => [o.personName, o]));
    expect(by.has('Helen Marsh')).toBe(false);
    expect(by.get('Omar Haddad')?.managerName).toBe('Helen Marsh');
    expect(by.get('Lukas Brandt')?.managerName).toBe('Priya Natarajan');
    expect(by.get('Sofia Ricci')).toMatchObject({ managerName: 'Priya Natarajan', confidence: 'high', status: 'new_node' });
    for (const o of out) expect(o.personKey).not.toBe(o.managerKey);
  });

  it('compares with the live chart', () => {
    const chart = [
      { nodeId: '00000000-0000-4000-8000-000000000001', parentId: null, emails: ['priya@nw.example'], linkedinHandle: null, name: 'Priya Natarajan' },
      { nodeId: '00000000-0000-4000-8000-000000000002', parentId: '00000000-0000-4000-8000-000000000001', emails: ['lukas@nw.example'], linkedinHandle: null, name: 'Lukas Brandt' },
      { nodeId: '00000000-0000-4000-8000-000000000003', parentId: null, emails: [], linkedinHandle: null, name: 'Sofia Ricci' },
    ];
    const out = inferReportingLines({ people, chart });
    const by = new Map(out.map((o) => [o.personName, o]));
    expect(by.get('Lukas Brandt')?.status).toBe('matches_chart');
    expect(by.get('Sofia Ricci')?.status).toBe('conflicts_chart');
  });

  it('filters by minimum confidence', () => {
    const out = inferReportingLines({ people, minConfidence: 'high' });
    expect(out.every((o) => o.confidence === 'high')).toBe(true);
  });
});

describe('tool inputs', () => {
  it('are strict and apply defaults', () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    expect(MarsToolInputs.list_meetings.parse({ accountId: id }).limit).toBe(25);
    expect(MarsToolInputs.suggest_org_chart.parse({ accountId: id }).minConfidence).toBe('medium');
    expect(() => MarsToolInputs.list_contacts.parse({ accountId: id, extra: 1 })).toThrow();
    expect(() => MarsToolInputs.list_contacts.parse({ accountId: 'nope' })).toThrow();
  });
  it('describe three read-only tools', () => {
    expect(MARS_TOOLS.map((t) => t.name)).toEqual(['list_meetings', 'list_contacts', 'suggest_org_chart']);
  });
});

describe('MarsEntry', () => {
  it('parses a minimal entry', () => {
    const r = MarsEntry.safeParse({
      id: 'mars-1', version: 1, updatedAt: '2026-10-30T10:00:00.000Z', weekOf: '2026-10-26', meetingDate: '2026-10-28T09:00:00.000Z',
      loggedBy: { name: 'Tony W', email: 'tony@bidstack.example' }, client: { name: 'Northwind Energy' }, contacts: [{ fullName: 'Helen Marsh' }],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
