// Safety copy in the accounts section. These strings tell a user what a
// destructive action does before they confirm it; copy edits must keep them.
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
];

describe('accounts section safety copy', () => {
  it.each(PINNED)('%s keeps "%s"', (file, copy) => {
    expect(read(file)).toContain(copy);
  });
});
