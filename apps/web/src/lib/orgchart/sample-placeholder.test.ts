// A demo account with no saved chart draws a Sample structure. Those slots
// are roles, not people. A personal name on an unmet slot reads as a contact
// the workspace never had.
import { describe, expect, it } from 'vitest';

import { sampleChart } from './sample';
import type { PersonCoverage } from './types';

const UNMET: PersonCoverage[] = [];

function metCio(): PersonCoverage {
  return {
    key: 'k1',
    name: 'Michael Johnson',
    title: 'Chief Information Officer',
    seniority: 'c_level',
    region: 'CA',
    contactId: null,
    reportsToContactId: null,
    meetings: [],
    challenges: [],
    owners: [],
    lastMetAt: null,
  } as PersonCoverage;
}

describe('sample chart placeholders', () => {
  it('labels an unmet demo slot as Sample instead of inventing a person', () => {
    // WHY: the empty demo roster still paints Alex Morgan, Priya Raman, and
    // Samuel Reyes. A seller treats those names as contacts. The slot is the
    // role, and the name has to say Sample.
    const chart = sampleChart('co', UNMET);
    const names = chart.nodes.map((node) => node.name);

    expect(names).not.toContain('Alex Morgan');
    expect(names).not.toContain('Priya Raman');
    expect(names).not.toContain('Samuel Reyes');
    expect(names.every((name) => name.startsWith('Sample '))).toBe(true);
    expect(chart.nodes.find((node) => node.title === 'Chief Executive Officer')?.name).toBe(
      'Sample Chief Executive Officer',
    );
    expect(chart.nodes.find((node) => node.title === 'Head of Group Treasury')?.name).toBe(
      'Sample Head of Group Treasury',
    );
  });

  it('puts a met person in the matching role slot and leaves the other slots as Sample', () => {
    // WHY: Michael Johnson is the CIO the meetings actually named. He has to
    // take that slot. Leaving "Sample Chief Information Officer" beside him,
    // or leaving Alex Morgan as the CEO, still invents a contact.
    const chart = sampleChart('co', [metCio()]);
    const cioSlots = chart.nodes.filter((node) => node.title === 'Chief Information Officer');

    expect(cioSlots).toHaveLength(1);
    expect(cioSlots[0]?.name).toBe('Michael Johnson');
    expect(cioSlots[0]?.source).not.toBe('sample');
    expect(chart.nodes.some((node) => node.name === 'Alex Morgan')).toBe(false);
    expect(chart.nodes.find((node) => node.title === 'Chief Executive Officer')?.name).toBe(
      'Sample Chief Executive Officer',
    );
  });
});
