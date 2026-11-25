// A linked contact's notes live on the company, not on the display name.
// Demo seed writes them with accountId = company id and companyId = company id
// (seedConsultingPartners). Asking /api/notes?accountId=MAPFRE returns nothing,
// so the contact reads "No notes" next to a note the account already has.
// An unlinked contact still has only the customer string, so that read stays
// on the name and keeps an exact accountId match.

export interface ContactNoteScope {
  customer: string;
  companyId: string | null;
}

export interface ContactNotesRequest {
  accountId: string;
  companyId?: string;
}

export function contactNotesRequest(contact: ContactNoteScope): ContactNotesRequest {
  if (contact.companyId) {
    return { accountId: contact.companyId, companyId: contact.companyId };
  }
  return { accountId: contact.customer };
}

export function notesVisibleOnContact<T extends { accountId: string }>(
  notes: T[],
  contact: ContactNoteScope,
): T[] {
  if (contact.companyId) return notes;
  return notes.filter((note) => note.accountId === contact.customer);
}

// A whitespace-only body is not a sentence. Rendering it adds a blank line
// under the title and looks like the note failed to load.
export function contactNoteBody(bodyMd: string): string | null {
  const text = bodyMd.trim();
  return text.length > 0 ? text : null;
}
