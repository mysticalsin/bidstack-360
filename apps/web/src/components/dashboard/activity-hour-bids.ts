// The hour chart counts activities. These rows are the same hour, so a person
// can open the bid the count came from. The clock matches activityByHour.

export interface HourActivity {
  occurredAt: string;
  type: string;
  subject?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface HourBidLink {
  subject: string;
  /** Opportunity route. Null when the activity is not filed on a bid. */
  href: string | null;
}

export interface HourBidRead {
  links: HourBidLink[];
  /** In this hour, with no bid and no subject to show. */
  unnamed: number;
}

function hourInZone(iso: string, timeZone: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const part = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone })
    .formatToParts(d)
    .find((p) => p.type === 'hour');
  const h = Number(part?.value);
  return Number.isInteger(h) && h >= 0 && h < 24 ? h : null;
}

/**
 * Activities whose clock hour, in `timeZone`, is `hour`.
 * Ordered by time of day, then by the calendar day, so 14:00 stays ahead of
 * 14:20 even when that 14:00 row is a later date. A blank bid subject is
 * "Open the bid". Anything that is not an opportunity stays unlinked.
 */
export function bidsInHour(items: readonly HourActivity[], hour: number, timeZone: string): HourBidRead {
  const rows: Array<HourBidLink & { at: string }> = [];
  let unnamed = 0;
  for (const item of items) {
    if (hourInZone(item.occurredAt, timeZone) !== hour) continue;
    const subject = item.subject?.trim() ?? '';
    const onBid = item.entityType === 'opportunity' && Boolean(item.entityId);
    if (onBid) {
      rows.push({
        at: item.occurredAt,
        subject: subject || 'Open the bid',
        href: `/opportunities/${item.entityId}`,
      });
    } else if (subject) {
      rows.push({ at: item.occurredAt, subject, href: null });
    } else {
      unnamed += 1;
    }
  }
  rows.sort((a, b) => a.at.slice(11).localeCompare(b.at.slice(11)) || a.at.localeCompare(b.at));
  return { links: rows.map(({ subject, href }) => ({ subject, href })), unnamed };
}
