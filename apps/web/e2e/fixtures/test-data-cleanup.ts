import type { APIRequestContext } from '@playwright/test';

type ContactListResponse = {
  items: Array<{
    id: string;
    customer: string;
    name: string;
  }>;
};

const TEST_IMPORT_SEARCHES = [
  'E2E Buyer',
  'Attendees:',
  'Risk:',
  'Meeting Import',
] as const;

function isMeetingImportArtifact(contact: ContactListResponse['items'][number]): boolean {
  const name = contact.name.trim();
  const customer = contact.customer.trim();
  return (
    name === 'E2E Buyer' ||
    name.startsWith('Attendees:') ||
    name.startsWith('Risk:') ||
    customer.startsWith('Meeting Import')
  );
}

export async function cleanupMeetingImportContacts(request: APIRequestContext): Promise<void> {
  const ids = new Set<string>();

  for (const search of TEST_IMPORT_SEARCHES) {
    const res = await request.get(`/api/contacts?search=${encodeURIComponent(search)}&limit=100`);
    if (!res.ok()) {
      throw new Error(`Could not search test contact artifacts for "${search}" (${res.status()})`);
    }
    const body = (await res.json()) as ContactListResponse;
    for (const contact of body.items) {
      if (isMeetingImportArtifact(contact)) ids.add(contact.id);
    }
  }

  for (const id of ids) {
    const res = await request.delete(`/api/contacts/${id}`);
    if (!res.ok() && res.status() !== 404) {
      throw new Error(`Could not delete test contact artifact ${id} (${res.status()})`);
    }
  }
}
