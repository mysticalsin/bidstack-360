import { describe, expect, it } from 'vitest';

import { contactNoteBody, contactNotesRequest, notesVisibleOnContact } from './contact-notes';

const MAPFRE = '11111111-1111-4111-8111-111111111111';

describe('contactNotesRequest', () => {
  it('asks for the company when the contact is linked, because demo notes are stored on that id', () => {
    expect(contactNotesRequest({ customer: 'MAPFRE', companyId: MAPFRE })).toEqual({
      accountId: MAPFRE,
      companyId: MAPFRE,
    });
  });

  it('keeps an unlinked contact on the customer name', () => {
    expect(contactNotesRequest({ customer: 'Globex', companyId: null })).toEqual({
      accountId: 'Globex',
    });
  });
});

describe('notesVisibleOnContact', () => {
  it('keeps a company-id note on a linked contact instead of dropping it for not matching the display name', () => {
    const note = { id: 'n-1', accountId: MAPFRE };
    expect(notesVisibleOnContact([note], { customer: 'MAPFRE', companyId: MAPFRE })).toEqual([note]);
  });

  it('still hides a different customer name when the contact is not linked', () => {
    const foreign = { id: 'n-2', accountId: 'Globex Labs' };
    expect(notesVisibleOnContact([foreign], { customer: 'Globex', companyId: null })).toEqual([]);
  });
});

describe('contactNoteBody', () => {
  it('drops a whitespace-only body so the title stays the whole row', () => {
    expect(contactNoteBody('   ')).toBeNull();
    expect(contactNoteBody('The CIO office said we were faster.')).toBe(
      'The CIO office said we were faster.',
    );
  });
});
