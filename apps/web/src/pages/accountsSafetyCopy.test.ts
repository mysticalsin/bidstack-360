// Safety copy in the accounts section. These strings tell a user what a
// destructive action does before they confirm it, or what a record does not
// mean; copy edits must keep them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const pages = join(__dirname);
const read = (file: string) => readFileSync(join(pages, file), 'utf8');

const PINNED: Array<[string, string]> = [
  ['ContactsPage.tsx', 'They will be removed from any linked bids. The audit log records each deletion.'],
  ['ContactsPage.tsx', 'This also removes them from any linked bids. The audit log keeps a record.'],
  ['ContactsPage.tsx', 'The successful deletions were committed; try again for the remainder.'],
  ['LeadsPage.tsx', 'This action cannot be undone.'],
  ['LeadsPage.tsx', 'This will permanently remove {{name}} from your leads.'],
  ['LeadDetailPage.tsx', 'This will permanently remove {{firstName}} {{lastName}} from your leads.'],
  ['CompaniesPage.tsx', 'This action cannot be undone.'],
  ['TerritoriesPage.tsx', 'This territory will be deactivated.'],
  ['TerritoriesPage.tsx', 'This routing rule will be deactivated.'],
  ['../components/people/AccountPeopleSection.tsx', 'A title on file is not authority.'],
  ['../components/people/AccountPeopleSection.tsx', 'Internal tasks stay in the list below and are not the same record.'],
  ['../components/people/AccountPeopleSection.tsx', 'Do not link it to a deal until someone reviews it.'],
  ['../components/people/AccountPeopleSection.tsx', 'Saving a task does not create a customer commitment.'],
];

// Taglines and empty-state helper lines cut in review; titles carry the state.
const CUT: Array<[string, string]> = [
  ['TerritoriesPage.tsx', 'Global opportunity footprint, territory coverage, and lead routing.'],
  ['territoriesPage/TerritoryPanels.tsx', 'Create your first territory to get started.'],
  ['territoriesPage/TerritoryPanels.tsx', 'Create your first rule to auto-assign leads.'],
  ['kam/KamAccountPage.tsx', 'Capture workshop initiatives, track them to a qualified opportunity'],
];

describe('accounts section safety copy', () => {
  it.each(PINNED)('%s keeps "%s"', (file, copy) => {
    expect(read(file)).toContain(copy);
  });

  it.each(CUT)('%s no longer shows "%s"', (file, copy) => {
    expect(read(file)).not.toContain(copy);
  });
});
