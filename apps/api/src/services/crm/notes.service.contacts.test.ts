import { describe, expect, it } from 'vitest';

import type { MeetingImportedContact } from '@bidstack/shared';

import { planContactWrites } from './notes.service';

function person(name: string, email: string | null): MeetingImportedContact {
  return { name, title: null, email, phone: null, roleInDecision: null, confidence: null };
}

const open = { emailsCapped: false, namesCapped: false };

describe('planContactWrites', () => {
  it('links one unlinked email and leaves a person who already has a company', () => {
    // WHY: a meeting used to be able to miss the email row and mint a second person.
    const plan = planContactWrites(
      [person('Unlinked', 'unlinked@example.com'), person('Kept', 'kept@example.com'), person('Jane Shared', 'fresh@example.com')],
      [
        { id: 'unlinked', email: 'unlinked@example.com', name: 'Unlinked', companyId: null },
        { id: 'kept', email: 'kept@example.com', name: 'Jane Shared', companyId: 'other' },
      ],
      [],
      'fresh',
      open,
    );
    expect(plan.linkIds).toEqual(['unlinked']);
    expect(plan.create.map((row) => row.email)).toEqual(['fresh@example.com']);
  });

  it('does not link or create when the email page is full', () => {
    // WHY: the thousandth row is not proof this email is unique or new.
    const plan = planContactWrites(
      [person('Unlinked', 'unlinked@example.com'), person('New', 'new@example.com')],
      [{ id: 'unlinked', email: 'unlinked@example.com', name: 'Unlinked', companyId: null }],
      [],
      'fresh',
      { emailsCapped: true, namesCapped: false },
    );
    expect(plan.linkIds).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it('skips a nameless person when this account already has that name, and when the name page is full', () => {
    // WHY: a full name page used to look empty and create the person again.
    const present = planContactWrites(
      [person('Jane Shared', null)],
      [],
      [{ id: 'jane', email: null, name: 'jane shared', companyId: 'fresh' }],
      'fresh',
      open,
    );
    expect(present.create).toEqual([]);
    const capped = planContactWrites(
      [person('Someone New', null)],
      [],
      [],
      'fresh',
      { emailsCapped: false, namesCapped: true },
    );
    expect(capped.create).toEqual([]);
  });

  it('does not treat two rows with one email as the unlinked person', () => {
    const plan = planContactWrites(
      [person('Unlinked', 'shared@example.com')],
      [
        { id: 'a', email: 'shared@example.com', name: 'A', companyId: null },
        { id: 'b', email: 'shared@example.com', name: 'B', companyId: null },
      ],
      [],
      'fresh',
      open,
    );
    expect(plan.linkIds).toEqual([]);
    expect(plan.create).toEqual([]);
  });
});
