import { describe, expect, it } from 'vitest';

import { extractMeetingNotes } from './notes.service.helpers';

const source = {
  source: 'meeting_notes_import',
  label: 'Meeting notes import',
  sourceUrl: null,
  fetchedAt: '2026-06-01T00:00:00.000Z',
  confidence: null,
  providerMetadata: { confidenceBasis: 'not_scored' },
};

describe('extractMeetingNotes', () => {
  it('does not turn a mentioned product or attendee into a confidence score', () => {
    const extracted = extractMeetingNotes(
      [
        'Attendees: Jane Doe - IT Security Manager, jane.import@example.com',
        'Tech stack: Azure, Okta',
        'Action: Send the deployment plan by 2026-06-15',
      ].join('\n'),
      'Northwind',
      source,
    );

    const vendors = extracted.techStack.flatMap((category) => category.items);
    expect(vendors.map((item) => item.name)).toEqual(expect.arrayContaining(['Azure', 'Okta']));
    expect(vendors.every((item) => item.confidence === null)).toBe(true);
    expect(extracted.contacts[0]?.confidence).toBeNull();
    expect(extracted.tasks[0]?.confidence).toBeNull();
    // "Security" and a name are not a buying role.
    expect(extracted.contacts[0]?.roleInDecision).toBeNull();
  });

  it('keeps a decision role only when the note names one', () => {
    // WHY: "Buyer" in a name, or "technical" in a title, used to become a
    // stored buying role. The account then showed a station nobody recorded.
    const guessed = extractMeetingNotes(
      'Attendees: Linked Buyer - Technical Lead, buyer@example.com',
      'Northwind',
      source,
    );
    expect(guessed.contacts[0]?.roleInDecision).toBeNull();
    expect(guessed.contacts[0]?.title).toContain('Technical Lead');

    const stated = extractMeetingNotes(
      'Attendees: Ada Lovelace - CFO, ada@example.com. Decision role: champion',
      'Northwind',
      source,
    );
    expect(stated.contacts[0]?.roleInDecision).toBe('champion');
  });

  it('does not invent a risk or a severity from a job title', () => {
    // WHY: "IT Security Manager" and a compliance status used to become
    // medium risks. A risk line with no rank stays unranked.
    const extracted = extractMeetingNotes(
      [
        'Attendees: Jane Doe - IT Security Manager, jane@example.com',
        'Compliance: ISO 27001 complete',
        'Risk: Endpoint migration timing is unclear',
        'Risk: High concern around the cutover. Owner: Jane',
      ].join('\n'),
      'Northwind',
      source,
    );
    const titles = extracted.risks.map((risk) => risk.title);
    expect(titles.some((title) => /security manager/i.test(title))).toBe(false);
    expect(titles.some((title) => /iso 27001/i.test(title))).toBe(false);
    const unranked = extracted.risks.find((risk) => /unclear/i.test(risk.title));
    const ranked = extracted.risks.find((risk) => /cutover/i.test(risk.title));
    expect(unranked?.severity).toBeNull();
    expect(ranked?.severity).toBe('high');
  });
});
