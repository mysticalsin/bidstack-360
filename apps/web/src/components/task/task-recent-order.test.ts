import { describe, expect, it } from 'vitest';

import { orderRecentFollowUps } from './task-recent-order';

// The demo route returns due-day order. On 25 Nov 2026 the finished
// Stellantis handover (23 Nov) is loaded ahead of the open IKEA annex
// (28 Nov). Recent is that loaded order. A finished row must not lead it.
const HANDOVER = {
  id: 'stellantis-handover',
  title: 'Kickoff handover to delivery, Stellantis',
  dueDate: '2026-11-23',
  status: 'done' as const,
};
const IKEA = {
  id: 'ikea-annex',
  title: 'Prepare pricing annex for IKEA',
  dueDate: '2026-11-28',
  status: 'open' as const,
};
const HSBC = {
  id: 'hsbc-questionnaire',
  title: 'Security questionnaire response, HSBC',
  dueDate: '2026-11-29',
  status: 'in_progress' as const,
};
const SIEMENS = {
  id: 'siemens-volume',
  title: 'Finalize technical volume for Siemens ERP',
  dueDate: '2026-11-30',
  status: 'in_progress' as const,
};
const SANOFI = {
  id: 'sanofi-workshop',
  title: 'Schedule discovery workshop with Sanofi CMIO',
  dueDate: '2026-12-02',
  status: 'open' as const,
};

describe('orderRecentFollowUps', () => {
  it('puts the finished demo handover after the open follow-ups', () => {
    // WHY: due-day order makes the done handover look like the next deadline.
    const ordered = orderRecentFollowUps([HANDOVER, IKEA, HSBC, SIEMENS, SANOFI]);
    expect(ordered.map((row) => row.title)).toEqual([
      IKEA.title,
      HSBC.title,
      SIEMENS.title,
      SANOFI.title,
      HANDOVER.title,
    ]);
  });

  it('keeps the loaded order inside each group', () => {
    // WHY: Recent is not a second due-day sort. An open row that was loaded
    // ahead of an earlier open row stays ahead. Two finished rows do the same.
    const blocked = { ...SANOFI, id: 'blocked-later', status: 'blocked' as const };
    const earlierDone = { ...HANDOVER, id: 'earlier-done', title: 'Archive the May pack' };
    const ordered = orderRecentFollowUps([SIEMENS, IKEA, earlierDone, blocked, HANDOVER]);
    expect(ordered.map((row) => row.id)).toEqual([
      SIEMENS.id,
      IKEA.id,
      blocked.id,
      earlierDone.id,
      HANDOVER.id,
    ]);
  });
});
