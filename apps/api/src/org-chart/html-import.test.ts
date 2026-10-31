import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cleanText, decodeDataImage, parseOrgChartHtml } from './html-import.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(path.join(here, '__fixtures__', n), 'utf8');

describe('parseOrgChartHtml: people-map export (JSON data island + sprite avatars)', () => {
  const r = parseOrgChartHtml(fixture('people-map.fake.html'));

  it('finds the people list, skips system accounts and keeps the reporting lines', () => {
    expect(r.format).toBe('json');
    expect(r.found).toBe(12);
    expect(r.skipped).toBe(1);
    expect(r.people).toHaveLength(11);
    expect(r.errors).toEqual([]);
    const bruno = r.people.find((p) => p.name === 'Bruno Costa')!;
    expect(bruno.managerRef).toBe('acme_ops-silva-ana');
    expect(bruno.ref).toBe('acme_ops-costa-bruno');
    expect(r.people.find((p) => p.name === 'Ana Silva')!.managerRef).toBeNull();
  });

  it('normalizes email, phone and LinkedIn, and drops bad values with a warning', () => {
    const bruno = r.people.find((p) => p.name === 'Bruno Costa')!;
    expect(bruno.email).toBe('bruno.costa@example.com');
    expect(bruno.phone).toBe('+551155550102');
    expect(bruno.linkedinUrl).toBe('https://www.linkedin.com/in/bruno-costa-example');
    const felipe = r.people.find((p) => p.name === 'Felipe Ortiz')!;
    expect(felipe.linkedinUrl).toBeNull(); // a /posts/ URL is not a profile
    expect(r.people.find((p) => p.name === 'Gabriela Lima')!.email).toBeNull();
    expect(r.warnings.map((w) => w.name)).toEqual(expect.arrayContaining(['Felipe Ortiz', 'Gabriela Lima']));
  });

  it('maps sprite avatars and the extra profile fields', () => {
    expect(r.sprite).toMatchObject({ cols: 4, type: 'image/webp' });
    expect(r.people.find((p) => p.name === 'Dan Nguyen')!.photo).toEqual({ kind: 'sprite', index: 3 });
    const ana = r.people.find((p) => p.name === 'Ana Silva')!;
    expect(ana.function).toBe('OPS');
    expect(ana.region).toBe('Brazil');
    expect(ana.businessUnit).toBe('OPS Brazil');
    expect(ana.profile).toMatchObject({
      headline: 'Chief Executive Officer at Example Corp',
      location: 'Example City, Brazil',
      tenure: 'At Example Corp since 2010',
      languages: ['English, Spanish'],
      themes: ['cloud', 'data'],
      linkedinConfidence: 'verified',
      fit: { score: 4, why: ['Runs a data programme'] },
    });
    expect(ana.profile.career?.[0]).toEqual({ role: 'Chief Executive Officer', org: 'Example Corp', period: '2010 - present' });
    expect(ana.profile.signals?.[0]).toMatchObject({ title: 'Announced a new data platform', url: 'https://example.com/news' });
    expect(r.people.find((p) => p.name === 'Ivan Petrov')!.profile).toMatchObject({ employer: 'Example Staffing', personKind: 'external' });
  });

  it('never keeps markup, scripts or bidi controls in text', () => {
    const hana = r.people.find((p) => p.name === 'Hana Park')!;
    expect(hana.title).toBe('Supply Chain Manager alert(1)');
    for (const p of r.people) expect(JSON.stringify(p)).not.toMatch(/<|>|\u202e|javascript:/i);
  });
});

describe('parseOrgChartHtml: table export', () => {
  const r = parseOrgChartHtml(fixture('people-table.fake.html'));
  it('reads the header row and links in cells', () => {
    expect(r.format).toBe('table');
    expect(r.people.map((p) => p.name)).toEqual(['Maya Chen', 'Omar Haddad', 'Lena Fischer']);
    const maya = r.people[0]!;
    expect(maya).toMatchObject({ email: 'maya.chen@example.org', phone: '+12125550199', linkedinUrl: 'https://www.linkedin.com/in/maya-chen-example', function: 'Executive' });
    expect(maya.photo).toEqual({ kind: 'url', url: 'https://images.example.org/maya.png' });
    expect(maya.profile.location).toBe('New York');
    expect(r.people[1]!.managerName).toBe('Maya Chen');
  });
  it('rejects look-alike LinkedIn hosts, javascript: and SVG photos, and short phones', () => {
    const [, omar, lena] = r.people;
    expect(omar!.linkedinUrl).toBeNull();
    expect(omar!.photo).toBeNull();
    expect(lena!.photo).toBeNull();
    expect(lena!.phone).toBeNull();
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
  });
});

describe('parseOrgChartHtml: hostile and edge input', () => {
  it('rejects files over 5 MB', () => {
    const r = parseOrgChartHtml(`<table><tr><th>Name</th></tr><tr><td>${'a'.repeat(5 * 1024 * 1024)}</td></tr></table>`);
    expect(r.people).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/over 5 MB/);
  });
  it('reports a file with no people', () => {
    const r = parseOrgChartHtml('<html><body><p>Hello</p><script>alert(1)</script></body></html>');
    expect(r.people).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/No people found/);
  });
  it('ignores people-looking text inside executable scripts and templates', () => {
    const r = parseOrgChartHtml('<script>var people=[{"name":"Eve","title":"CEO"}]</script><template><table><tr><th>Name</th></tr><tr><td>X</td></tr></table></template>');
    expect(r.people.map((p) => p.name)).not.toContain('Eve');
  });
  it('reads schema.org Person microdata and JSON-LD', () => {
    const md = parseOrgChartHtml('<div itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ines Duarte</span><span itemprop="jobTitle">CTO</span><a itemprop="email" href="mailto:ines@example.net">mail</a><a href="https://www.linkedin.com/in/ines-example">in</a></div>');
    expect(md.format).toBe('microdata');
    expect(md.people[0]).toMatchObject({ name: 'Ines Duarte', title: 'CTO', email: 'ines@example.net', linkedinUrl: 'https://www.linkedin.com/in/ines-example' });
    const ld = parseOrgChartHtml('<script type="application/ld+json">{"@type":"Person","name":"Raj Patel","jobTitle":"COO","telephone":"+91 22 5555 0100","sameAs":["https://in.linkedin.com/in/raj-example","https://github.com/raj-example"]}</script>');
    expect(ld.people[0]).toMatchObject({ name: 'Raj Patel', phone: '+912255550100', linkedinUrl: 'https://www.linkedin.com/in/raj-example' });
    expect(ld.people[0]!.profile.socials).toEqual([{ kind: 'github', url: 'https://github.com/raj-example' }]);
  });
  it('decodes inline photos only when the bytes match png, jpeg or webp, under 2 MB', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    expect(decodeDataImage(`data:image/png;base64,${png}`)).toMatchObject({ type: 'image/png' });
    expect(decodeDataImage(`data:image/jpeg;base64,${png}`)).toHaveProperty('error');
    expect(decodeDataImage('data:image/svg+xml;base64,PHN2Zy8+')).toHaveProperty('error');
    expect(decodeDataImage(`data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`)).toHaveProperty('error');
  });
  it('cleanText strips tags and caps length', () => {
    expect(cleanText('<b>Hi</b>\u0007 there')).toBe('Hi there');
    expect(cleanText('x'.repeat(50), 10)).toHaveLength(10);
  });
});
