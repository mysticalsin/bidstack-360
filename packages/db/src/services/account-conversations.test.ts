import { describe, expect, it } from 'vitest';

import type { Prisma } from '../../generated/client/index.js';

import {
  CONVERSATION_ORDER_SQL,
  buildConversationIdQuery,
  compareConversationRecency,
  conversationInstant,
} from './account-conversations.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const COMPANY = '00000000-0000-4000-8000-000000000020';
const NOVEMBER = '00000000-0000-4000-8000-0000000000a1';
const OCTOBER = '00000000-0000-4000-8000-0000000000b2';

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?');
}

describe('account conversation order', () => {
  it('pages by the timestamp the list displays, not the time the row was logged', () => {
    // Logged today for an October start. The list shows October, so it must
    // sort behind a synced November meeting even though it was written later.
    const loggedLate = {
      id: OCTOBER,
      startTime: new Date('2026-10-01T15:00:00.000Z'),
      occurredAt: new Date('2026-11-08T12:00:00.000Z'),
    };
    const syncedNovember = {
      id: NOVEMBER,
      startTime: new Date('2026-11-02T15:00:00.000Z'),
      occurredAt: new Date('2026-11-02T15:00:00.000Z'),
    };
    expect(conversationInstant(loggedLate).toISOString()).toBe('2026-10-01T15:00:00.000Z');
    expect(compareConversationRecency(syncedNovember, loggedLate)).toBeLessThan(0);

    const query = buildConversationIdQuery({
      orgId: ORG,
      companyId: COMPANY,
      opportunityIds: [],
      contactIds: [],
      cursor: { at: conversationInstant(syncedNovember), id: NOVEMBER },
      take: 26,
    });
    const text = sqlText(query);
    const uses = text.split(CONVERSATION_ORDER_SQL).length - 1;
    expect(uses).toBeGreaterThanOrEqual(3);
    expect(text).toContain(`ORDER BY ${CONVERSATION_ORDER_SQL} DESC`);
    expect(text).not.toContain('ORDER BY occurred_at');
  });
});
