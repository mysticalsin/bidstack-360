import { describe, expect, it } from 'vitest';

import { ceoScore, OrgChartNodeCreate, OrgChartNodePatch, parseCsv, parseOrgChartCsv, wouldCreateCycle } from './org-chart.js';

describe('wouldCreateCycle', () => {
  // root -> a -> b -> c ; root -> d
  const parentOf = new Map<string, string | null>([
    ['root', null],
    ['a', 'root'],
    ['b', 'a'],
    ['c', 'b'],
    ['d', 'root'],
  ]);
  it('rejects moving a node under itself or a descendant', () => {
    expect(wouldCreateCycle(parentOf, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(parentOf, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(parentOf, 'root', 'd')).toBe(true);
  });
  it('allows moving across branches or up', () => {
    expect(wouldCreateCycle(parentOf, 'c', 'd')).toBe(false);
    expect(wouldCreateCycle(parentOf, 'b', 'root')).toBe(false);
    expect(wouldCreateCycle(parentOf, 'd', 'c')).toBe(false);
  });
  it('treats corrupt loops as cycles instead of spinning', () => {
    const bad = new Map<string, string | null>([
      ['x', 'y'],
      ['y', 'x'],
    ]);
    expect(wouldCreateCycle(bad, 'z', 'x')).toBe(true);
  });
});

describe('ceoScore', () => {
  it('ranks CEO titles first and excludes deputies and assistants', () => {
    expect(ceoScore('Chief Executive Officer')).toBe(3);
    expect(ceoScore('CEO & Co-founder')).toBe(3);
    expect(ceoScore('Président Directeur Général')).toBe(2);
    expect(ceoScore('Founder')).toBe(1);
    expect(ceoScore('Executive Assistant to the CEO')).toBe(0);
    expect(ceoScore('Deputy CEO')).toBe(0);
    expect(ceoScore('Regional Managing Director')).toBe(0);
    expect(ceoScore('CFO')).toBe(0);
    expect(ceoScore(null)).toBe(0);
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas, CRLF, BOM and blank lines', () => {
    const rows = parseCsv('\uFEFFname,title\r\n"Doe, Jane","Says ""hi"""\r\n\r\nBob,CTO\n');
    expect(rows).toEqual([
      ['name', 'title'],
      ['Doe, Jane', 'Says "hi"'],
      ['Bob', 'CTO'],
    ]);
  });
  it('keeps newlines inside quoted cells', () => {
    expect(parseCsv('a\n"x\ny"')).toEqual([['a'], ['x\ny']]);
  });
});

describe('parseOrgChartCsv', () => {
  it('normalizes headers, infers seniority from title, validates per line', () => {
    const csv = [
      'Name,Title,Email,Manager Email,Relationship-Strength,Sentiment,Photo URL,Extra',
      'Ana CEO,Chief Executive Officer,ana@acme.test,,5,warm,https://img.test/a.png,x',
      'Bo,VP Sales,BO@ACME.TEST,ana@acme.test,,,,',
      ',CTO,,,,,,',
      'Cy,Dir,not-an-email,,,,,',
      'Di,,,,9,,,',
      'Ed,,,,,,http://insecure.test/x.png,',
      'Fa,,,,,angry,,',
    ].join('\n');
    const { rows, errors } = parseOrgChartCsv(csv);
    expect(rows.map((r) => [r.name, r.seniority, r.email, r.managerEmail])).toEqual([
      ['Ana CEO', 'c_level', 'ana@acme.test', null],
      ['Bo', 'vp', 'bo@acme.test', 'ana@acme.test'],
    ]);
    expect(rows[0]).toMatchObject({ relationshipStrength: 5, sentiment: 'warm', photoUrl: 'https://img.test/a.png' });
    expect(errors.map((e) => e.line)).toEqual([1, 4, 5, 6, 7, 8]);
    expect(errors[0]!.message).toContain('extra');
  });
  it('requires a name column and caps rows', () => {
    expect(parseOrgChartCsv('title\nCEO').errors[0]!.message).toContain('name');
    expect(parseOrgChartCsv('name\na\nb\nc', 2).errors[0]!.message).toContain('Too many rows');
    expect(parseOrgChartCsv('').errors[0]!.message).toBe('CSV is empty');
  });
});

describe('body schemas', () => {
  it('placeholder needs a name; https-only photos; patch needs a field besides version', () => {
    expect(OrgChartNodeCreate.safeParse({ title: 'VP Data' }).success).toBe(false);
    expect(OrgChartNodeCreate.safeParse({ name: 'VP Data (vacant)' }).success).toBe(true);
    expect(OrgChartNodeCreate.safeParse({ name: 'x', photoUrl: 'http://a.test/x.png' }).success).toBe(false);
    expect(OrgChartNodeCreate.safeParse({ name: 'x', relationshipStrength: 6 }).success).toBe(false);
    expect(OrgChartNodePatch.safeParse({ version: 1 }).success).toBe(false);
    expect(OrgChartNodePatch.safeParse({ version: 1, title: 'CEO' }).success).toBe(true);
  });
});
