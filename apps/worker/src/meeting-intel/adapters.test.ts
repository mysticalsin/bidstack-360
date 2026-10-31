import { describe, expect, it, vi } from 'vitest';

import { applyMeetingConsent } from '@bidstack/shared';

import {
  abcAdapter,
  type AbcClient,
  defaultAdapters,
  mapMetisMeeting,
  metisAdapter,
  type MetisBrainClient,
  type MetisMeetingSummary,
  SourceNotConfiguredError,
} from './adapters.js';

const ctx = {
  orgId: 'o',
  userId: 'u',
  since: null,
  accounts: [{ companyId: 'c1', name: 'Acme France', domain: 'acme.fr', abcExternalId: 'ABC-1' }],
  includeTranscript: false,
};

const metisRow: MetisMeetingSummary = {
  id: 'm-1',
  date: '2026-10-30T09:00:00Z',
  title24: 'Acme ERP roadmap',
  topics: ['ERP migration'],
  account: { name: 'Acme France' },
  people: [{ name: 'Jane Roe', role: 'CFO', org: 'Acme', email: 'jane@acme.fr' }],
  signals: [
    { kind: 'objection', statement: 'Close takes 12 days', quote: 'honestly our close is a nightmare' },
    { kind: 'positive', statement: 'Likes the plan', quote: 'love it' },
  ],
  commitments: [{ text: 'Send ERP references', by: 'you', quote: 'I will send you refs' }],
  deal: { name: 'ERP AMS', stage: 'discovery' },
  summary: 'Discussed the ERP roadmap.',
  confidential: false,
  transcript: 'FULL TRANSCRIPT',
};

describe('ABC adapter (mocked client)', () => {
  it('pages through, scopes to known ABC account ids and maps fields', async () => {
    const listMeetings = vi
      .fn<AbcClient['listMeetings']>()
      .mockResolvedValueOnce({
        items: [
          {
            id: 'a1',
            subject: 'QBR',
            startAt: '2026-10-29T10:00:00Z',
            accountId: 'ABC-1',
            accountName: 'Acme France',
            webUrl: 'https://abc.example/m/a1',
            notes: 'Notes',
            participants: [{ fullName: 'Jean Dupont', email: 'jd@acme.fr', jobTitle: 'IT Director', country: 'FR', department: 'Group IT' }],
            nextSteps: ['Workshop'],
          },
        ],
        nextPageToken: 'p2',
      })
      .mockResolvedValueOnce({ items: [], nextPageToken: null });
    const out = await abcAdapter({ listMeetings }).pull(ctx);
    expect(listMeetings).toHaveBeenCalledTimes(2);
    expect(listMeetings.mock.calls[0]![0].accountIds).toEqual(['ABC-1']);
    expect(listMeetings.mock.calls[1]![0].pageToken).toBe('p2');
    expect(out[0]).toMatchObject({
      externalId: 'a1',
      accountExternalId: 'ABC-1',
      url: 'https://abc.example/m/a1',
      attendees: [{ name: 'Jean Dupont', title: 'IT Director', region: 'FR', businessUnit: 'Group IT' }],
      nextSteps: ['Workshop'],
    });
    expect(out[0]!.transcript).toBeUndefined();
  });

  it('default clients are not configured', async () => {
    await expect(defaultAdapters.abc.pull(ctx)).rejects.toBeInstanceOf(SourceNotConfiguredError);
    await expect(defaultAdapters.metis.pull(ctx)).rejects.toBeInstanceOf(SourceNotConfiguredError);
  });
});

describe('Metis adapter (mocked brain)', () => {
  it('pulls for one user, never asks for a transcript without consent, and drops verbatim quotes', async () => {
    const listMeetingSummaries = vi.fn<MetisBrainClient['listMeetingSummaries']>().mockResolvedValue([metisRow]);
    const [m] = await metisAdapter({ listMeetingSummaries }).pull(ctx);
    expect(listMeetingSummaries).toHaveBeenCalledWith({
      userId: 'u',
      since: null,
      accountNames: ['Acme France'],
      includeTranscript: false,
    });
    expect(m!.transcript).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/nightmare|love it|I will send/);
    expect(m).toMatchObject({
      accountName: 'Acme France',
      challenges: ['Close takes 12 days'],
      nextSteps: ['Send ERP references'],
      opportunities: ['ERP AMS (discovery)'],
      attendees: [{ name: 'Jane Roe', title: 'CFO', email: 'jane@acme.fr' }],
    });
  });

  it('keeps the transcript only with consent', () => {
    expect(mapMetisMeeting(metisRow, { includeTranscript: true }).transcript).toBe('FULL TRANSCRIPT');
  });
});

describe('applyMeetingConsent', () => {
  const m = mapMetisMeeting(metisRow, { includeTranscript: true });
  it('refuses confidential meetings and users without summary consent', () => {
    expect(applyMeetingConsent({ ...m, confidential: true }, { source: 'metis', shareSummary: true, shareTranscript: true })).toEqual({ ok: false, reason: 'confidential' });
    expect(applyMeetingConsent(m, { source: 'metis', shareSummary: false, shareTranscript: true })).toEqual({ ok: false, reason: 'no_consent' });
  });
  it('drops the transcript unless allowed, and always for non-Metis sources', () => {
    const a = applyMeetingConsent(m, { source: 'metis', shareSummary: true, shareTranscript: false });
    expect(a.ok && a.meeting.transcript).toBeFalsy();
    expect(a.ok && a.transcriptDropped).toBe(true);
    const b = applyMeetingConsent(m, { source: 'metis', shareSummary: true, shareTranscript: true });
    expect(b.ok && b.meeting.transcript).toBe('FULL TRANSCRIPT');
    const c = applyMeetingConsent(m, { source: 'abc', shareSummary: true, shareTranscript: true });
    expect(c.ok && c.meeting.transcript).toBeFalsy();
    expect(b.ok && 'confidential' in b.meeting).toBe(false);
  });
});
