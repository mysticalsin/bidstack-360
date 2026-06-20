import type { APIRequestContext } from '@playwright/test';

type ContactListResponse = {
  items: Array<{
    id: string;
    customer: string;
    name: string;
  }>;
};

type OpportunityListResponse = {
  items: Array<{
    id: string;
    code: string;
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

const TEST_OPPORTUNITY_SEARCHES = [
  'Convert Opp',
  'RFP Integration Test',
  'RFP-APPR',
  'approve-gate',
  'E2E Pipeline QA',
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

function isOpportunityArtifact(opportunity: OpportunityListResponse['items'][number]): boolean {
  const code = opportunity.code.trim();
  const name = opportunity.name.trim();
  const customer = opportunity.customer.trim();
  return (
    code.startsWith('RFP-APPR-') ||
    customer.startsWith('E2E Pipeline QA') ||
    name.startsWith('Convert Opp') ||
    name.startsWith('E2E Pipeline QA') ||
    name.startsWith('RFP Integration Test') ||
    name.includes('approve-gate')
  );
}

export async function cleanupMeetingImportContacts(request: APIRequestContext): Promise<void> {
  const ids = new Set<string>();

  for (const search of TEST_IMPORT_SEARCHES) {
    const res = await request.get(`/api/v1/contacts?search=${encodeURIComponent(search)}&limit=100`);
    if (!res.ok()) {
      throw new Error(`Could not search test contact artifacts for "${search}" (${res.status()})`);
    }
    const body = (await res.json()) as ContactListResponse;
    for (const contact of body.items) {
      if (isMeetingImportArtifact(contact)) ids.add(contact.id);
    }
  }

  for (const id of ids) {
    const res = await request.delete(`/api/v1/contacts/${id}`);
    if (!res.ok() && res.status() !== 404) {
      throw new Error(`Could not delete test contact artifact ${id} (${res.status()})`);
    }
  }
}

export async function cleanupOpportunityArtifacts(request: APIRequestContext): Promise<void> {
  const ids = new Set<string>();

  for (const search of TEST_OPPORTUNITY_SEARCHES) {
    const res = await request.get(`/api/v1/opportunities?search=${encodeURIComponent(search)}&limit=100`);
    if (!res.ok()) {
      throw new Error(`Could not search test opportunity artifacts for "${search}" (${res.status()})`);
    }
    const body = (await res.json()) as OpportunityListResponse;
    for (const opportunity of body.items) {
      if (isOpportunityArtifact(opportunity)) ids.add(opportunity.id);
    }
  }

  for (const id of ids) {
    const res = await request.delete(`/api/v1/opportunities/${id}`);
    if (!res.ok() && res.status() !== 404) {
      throw new Error(`Could not delete test opportunity artifact ${id} (${res.status()})`);
    }
  }
}

export async function cleanupVisualRegressionArtifacts(request: APIRequestContext): Promise<void> {
  await cleanupMeetingImportContacts(request);
  await cleanupOpportunityArtifacts(request);
}
