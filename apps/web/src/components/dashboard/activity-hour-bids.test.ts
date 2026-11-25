import { describe, expect, it } from 'vitest';

import { activityByHour } from '@/components/charts/bid-chart-data';

import { bidsInHour } from './activity-hour-bids';

// Demo activities are filed on bids (OP-2041 at 14:00 is "Exec sponsor catch-up").
// The hour chart already counts that hour as the busiest. The count is not the
// bid: the same hour has to name the work and point at the opportunity.
const DEMO_HOUR = [
  {
    occurredAt: '2026-11-23T14:00:00.000Z',
    type: 'call',
    subject: 'Exec sponsor catch-up',
    entityType: 'opportunity',
    entityId: 'opp-2041',
  },
  {
    occurredAt: '2026-11-13T14:20:00.000Z',
    type: 'call',
    subject: 'Proposal walkthrough',
    entityType: 'opportunity',
    entityId: 'opp-2047',
  },
  {
    occurredAt: '2026-11-18T14:30:00.000Z',
    type: 'email',
    subject: 'Cutover window proposal',
    entityType: 'opportunity',
    entityId: 'opp-2043',
  },
  {
    occurredAt: '2026-11-22T14:05:00.000Z',
    type: 'note',
    subject: 'Clinical sign-off needed before cutover',
    entityType: 'opportunity',
    entityId: 'opp-2043',
  },
  {
    occurredAt: '2026-11-22T09:30:00.000Z',
    type: 'call',
    subject: 'Procurement timeline check',
    entityType: 'opportunity',
    entityId: 'opp-2048',
  },
];

describe('bidsInHour', () => {
  it('names the demo bids logged at 14:00 and leaves 09:00 out', () => {
    const at14 = bidsInHour(DEMO_HOUR, 14, 'UTC');
    expect(at14.links.map((link) => link.subject)).toEqual([
      'Exec sponsor catch-up',
      'Clinical sign-off needed before cutover',
      'Proposal walkthrough',
      'Cutover window proposal',
    ]);
    expect(at14.links.map((link) => link.href)).toEqual([
      '/opportunities/opp-2041',
      '/opportunities/opp-2043',
      '/opportunities/opp-2047',
      '/opportunities/opp-2043',
    ]);
    expect(at14.unnamed).toBe(0);
    expect(bidsInHour(DEMO_HOUR, 9, 'UTC').links.map((link) => link.subject)).toEqual([
      'Procurement timeline check',
    ]);

    const chart = activityByHour(DEMO_HOUR, 'UTC');
    const counted = chart.series.reduce((sum, series) => sum + (series.values[14] ?? 0), 0);
    expect(at14.links.length + at14.unnamed).toBe(counted);
  });

  it('uses the viewer hour, so 14:30 UTC is 09:30 in New York', () => {
    const item = {
      occurredAt: '2026-11-02T14:30:00.000Z',
      type: 'call',
      subject: 'Procurement timeline check',
      entityType: 'opportunity',
      entityId: 'opp-2048',
    };
    expect(bidsInHour([item], 14, 'America/New_York').links).toEqual([]);
    expect(bidsInHour([item], 9, 'America/New_York').links).toEqual([
      { subject: 'Procurement timeline check', href: '/opportunities/opp-2048' },
    ]);
  });

  it('does not invent an opportunity link for a record that is not a bid', () => {
    const read = bidsInHour(
      [
        {
          occurredAt: '2026-11-02T14:00:00.000Z',
          type: 'note',
          subject: 'Office move',
          entityType: 'company',
          entityId: 'co-1',
        },
        {
          occurredAt: '2026-11-02T14:10:00.000Z',
          type: 'call',
          subject: '   ',
          entityType: 'opportunity',
          entityId: 'opp-1',
        },
        {
          occurredAt: 'not-a-date',
          type: 'call',
          subject: 'Dropped',
          entityType: 'opportunity',
          entityId: 'opp-x',
        },
      ],
      14,
      'UTC',
    );
    expect(read.links).toEqual([
      { subject: 'Office move', href: null },
      { subject: 'Open the bid', href: '/opportunities/opp-1' },
    ]);
    expect(read.unnamed).toBe(0);
  });
});
