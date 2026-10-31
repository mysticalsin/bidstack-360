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
  });
});
