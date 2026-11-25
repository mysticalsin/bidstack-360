// WHY: the meeting-notes paste example starts with "Attendees:" and a risk
// line that names an owner. The heading was stored as part of the person,
// and the risk sentence was stored as a second contact. The People list
// then shows a label and a risk instead of the person who attended.

import { describe, expect, it } from 'vitest';

import { extractMeetingNotes } from './notes.service.helpers.js';

const SOURCE = {
  source: 'meeting_notes_import',
  label: 'Meeting notes import',
  sourceUrl: null,
  fetchedAt: '2026-06-01T12:00:00.000Z',
  confidence: 0.86,
  providerMetadata: {},
};

const PASTE = [
  'Attendees: Ada Sample - Security Lead, ada.sample@example.com',
  'Tech stack: Azure, Okta',
  'Compliance: SOC 2 in progress',
  'Risk: High concern around endpoint migration timing. Owner: Ada Sample',
  'Action: Send the endpoint plan by 2026-06-15',
].join('\n');

describe('meeting note contacts', () => {
  it('names the attendee and keeps the risk line out of the people list', () => {
    const extracted = extractMeetingNotes(PASTE, 'Harbor Synthetic Co', SOURCE);

    expect(extracted.contacts.map((contact) => contact.name)).toEqual(['Ada Sample']);
    expect(extracted.contacts[0]).toMatchObject({
      title: 'Security Lead',
      email: 'ada.sample@example.com',
    });
    expect(extracted.contacts[0]?.name.startsWith('Attendees:')).toBe(false);
    expect(extracted.contacts.some((contact) => contact.name.startsWith('Risk:'))).toBe(false);

    // The risk and the follow-up stay where they were. Only the person row changes.
    expect(extracted.risks.map((risk) => risk.owner)).toEqual(['Ada Sample']);
    expect(extracted.tasks.map((task) => task.title)).toEqual(['Send the endpoint plan by 2026-06-15']);
  });

  it('still reads a person line that starts with Owner', () => {
    const extracted = extractMeetingNotes('Owner: Bea Sample', 'Harbor Synthetic Co', SOURCE);

    expect(extracted.contacts.map((contact) => contact.name)).toEqual(['Bea Sample']);
  });

  it('reads a bulleted Attendees line the same way', () => {
    const extracted = extractMeetingNotes(
      '- Attendees: Ada Sample - Security Lead, ada.sample@example.com',
      'Harbor Synthetic Co',
      SOURCE,
    );

    expect(extracted.contacts.map((contact) => contact.name)).toEqual(['Ada Sample']);
    expect(extracted.contacts[0]?.title).toBe('Security Lead');
  });
});
