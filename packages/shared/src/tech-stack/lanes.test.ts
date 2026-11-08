import { describe, expect, it } from 'vitest';

import { TECH_RULES, TECH_RULE_COUNT } from './fingerprints.js';
import {
  companySlug,
  ctHostsFromCrtSh,
  githubOrgFromHtml,
  matchCtHosts,
  matchDnsRecords,
  matchGithubLanguages,
  matchHomepage,
  matchJobPostings,
} from './lanes.js';

const AT = '2026-11-07T12:00:00.000Z';
const names = (items: Array<{ name: string }>) => items.map((i) => i.name).sort();

describe('curated fingerprint set', () => {
  it('ships at least 60 enterprise technologies with unique names', () => {
    expect(TECH_RULE_COUNT).toBeGreaterThanOrEqual(60);
    expect(new Set(TECH_RULES.map((r) => r.name)).size).toBe(TECH_RULE_COUNT);
  });

  it('gives every rule at least one signal', () => {
    for (const r of TECH_RULES) {
      const signals = [r.mx, r.spf, r.txt, r.cname, r.ns, r.host, r.html, r.script, r.header, r.jobs].filter(Boolean);
      expect(signals.length, r.name).toBeGreaterThan(0);
    }
  });
});

describe('dns lane', () => {
  it('reads MX, SPF, TXT verification, NS and CNAME records', () => {
    const found = matchDnsRecords(
      'example.com',
      {
        mx: ['example-com.mail.protection.outlook.com.'],
        txt: [
          'v=spf1 include:spf.protection.outlook.com include:_spf.salesforce.com include:mktomail.com ~all',
          'atlassian-domain-verification=abc123',
          'docusign=1b2c',
          'MS=ms12345678',
        ],
        ns: ['ns1.example.ns.cloudflare.com'],
        cname: [{ host: 'help.example.com', target: 'example.zendesk.com.' }],
      },
      AT,
    );
    expect(names(found)).toEqual(['Atlassian', 'Cloudflare', 'DocuSign', 'Marketo', 'Microsoft 365', 'Salesforce', 'Zendesk']);
    const m365 = found.find((f) => f.name === 'Microsoft 365')!;
    expect(m365).toMatchObject({ source: 'open_data:dns', lane: 'dns', category: 'Collaboration', confidence: 0.95 });
    expect(m365.evidence.record).toContain('MX example.com');
    expect(m365.evidence.observedAt).toBe(AT);
  });

  it('spots email security gateways in MX', () => {
    const found = matchDnsRecords('acme.io', { mx: ['mx1.acme.pphosted.com', 'eu-smtp-inbound-1.mimecast.com'], txt: [], ns: [], cname: [] }, AT);
    expect(names(found)).toEqual(['Mimecast', 'Proofpoint']);
  });

  it('never echoes a verification token value', () => {
    const [hit] = matchDnsRecords('acme.io', { mx: [], txt: ['atlassian-domain-verification=SECRETVALUE'], ns: [], cname: [] }, AT);
    expect(hit!.evidence.record).not.toContain('SECRETVALUE');
  });
});

describe('certificate transparency lane', () => {
  it('parses crt.sh JSON and a body cut at the size cap', () => {
    const body = JSON.stringify([{ name_value: 'jira.acme.com\n*.acme.com' }, { name_value: 'ACME.okta.com' }]);
    expect(ctHostsFromCrtSh(body).sort()).toEqual(['acme.com', 'acme.okta.com', 'jira.acme.com']);
    const cut = `[{"name_value":"sap.acme.com"},{"name_value":"vpn.acme.com"},{"name_va`;
    expect(ctHostsFromCrtSh(cut).sort()).toEqual(['sap.acme.com', 'vpn.acme.com']);
    expect(ctHostsFromCrtSh('not json')).toEqual([]);
  });

  it('matches own subdomains on the first label and tenant hosts on the slug', () => {
    const found = matchCtHosts('acme.com', 'acme', ['jira.acme.com', 'sap-prd.acme.com', 'acme.service-now.com', 'other.service-now.com', 'shop.acme.com'], AT);
    expect(names(found)).toEqual(['Jira', 'SAP', 'ServiceNow']);
    expect(found.find((f) => f.name === 'ServiceNow')!.evidence.url).toBe('https://crt.sh/?q=acme.service-now.com');
  });

  it('only builds a tenant slug from a distinctive first label', () => {
    expect(companySlug('www.mahle.com')).toBe('mahle');
    expect(companySlug('ci.com')).toBeNull();
  });
});

describe('homepage lane', () => {
  it('matches scripts, markup and headers with the page as evidence', () => {
    const html = `<html><head><script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>
      <script src="https://cdn.cookielaw.org/otSDKStub.js"></script>
      <link href="/etc.clientlibs/site/clientlibs.css"></head><body><a href="https://github.com/AcmeCorp">GitHub</a></body></html>`;
    const found = matchHomepage({ url: 'https://acme.com/', html, headers: { 'CF-RAY': '8abc', Server: 'cloudflare' } }, AT);
    expect(names(found)).toEqual(['Adobe Experience Manager', 'Cloudflare', 'Google Tag Manager', 'OneTrust']);
    expect(found.every((f) => f.evidence.url === 'https://acme.com/' && f.source === 'open_data:web')).toBe(true);
    expect(githubOrgFromHtml(html)).toBe('acmecorp');
  });

  it('ignores reserved GitHub paths and ambiguous multiple orgs', () => {
    expect(githubOrgFromHtml('<a href="https://github.com/features">x</a>')).toBeNull();
    expect(githubOrgFromHtml('<a href="https://github.com/a1/">x</a><a href="https://github.com/b2/">y</a>')).toBeNull();
  });
});

describe('jobs lane', () => {
  it('counts technology mentions across public postings', () => {
    const postings = [
      { title: 'Senior Data Engineer, Databricks', department: 'Technology', skills: ['Databricks', 'Python'], url: 'https://boards.example/1', fetchedAt: AT },
      { title: 'Cloud Platform Engineer, Azure', department: null, skills: ['Azure', 'Terraform'], url: null, fetchedAt: AT },
      { title: 'SAP S/4HANA Finance Lead', department: 'Finance IT', skills: [], url: null, fetchedAt: AT },
      { title: 'Machine Learning Engineer', department: null, skills: ['Azure OpenAI', 'Python'], url: null, fetchedAt: AT },
    ];
    const found = matchJobPostings(postings, AT);
    expect(names(found)).toEqual(['Azure OpenAI', 'Databricks', 'Microsoft Azure', 'Python', 'SAP', 'Terraform']);
    const python = found.find((f) => f.name === 'Python')!;
    expect(python.evidence.record).toBe('Named in 2 of 4 public job postings');
    expect(python.confidence).toBeCloseTo(0.71);
    expect(found.find((f) => f.name === 'Databricks')!.evidence.url).toBe('https://boards.example/1');
  });

  it('does not read JavaScript as Java', () => {
    const found = matchJobPostings([{ title: 'JavaScript Developer', department: null, skills: [], url: null, fetchedAt: AT }], AT);
    expect(names(found)).not.toContain('Java');
  });
});

describe('github lane', () => {
  it('ranks languages of public non-fork, non-archived repositories', () => {
    const found = matchGithubLanguages('acme', [{ language: 'TypeScript' }, { language: 'TypeScript' }, { language: 'Go' }, { language: 'Python', fork: true }, { language: null }], AT);
    expect(found.map((f) => f.name)).toEqual(['TypeScript', 'Go']);
    expect(found[0]!.evidence).toMatchObject({ url: 'https://github.com/acme', record: 'Main language of 2 of 3 public repositories' });
  });
});
