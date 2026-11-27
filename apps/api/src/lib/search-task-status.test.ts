// The Tasks tab on workspace search prints the stored status under the title.
// Demo "Finalize technical volume for Siemens ERP" is in_progress. The tasks
// list already says In progress. The machine key is not that label.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { searchTaskStatusLabel } from './search-task-status.js';

describe('search task status label', () => {
  it('names a demo follow-up with the word the tasks list uses', () => {
    // WHY: Siemens ERP's follow-up is stored as in_progress. The Tasks tab
    // printed that token, so the row read as a field name.
    expect(searchTaskStatusLabel('in_progress')).toBe('In progress');
    expect(searchTaskStatusLabel('open')).toBe('Open');
    expect(searchTaskStatusLabel('blocked')).toBe('Blocked');
    expect(searchTaskStatusLabel('done')).toBe('Done');
  });

  it('keeps a status the tasks list does not name', () => {
    // WHY: a prettified unknown token would invent a status. The stored
    // word stays, and a blank does not become a label.
    expect(searchTaskStatusLabel('custom_hold')).toBe('custom_hold');
    expect(searchTaskStatusLabel('  in_progress  ')).toBe('In progress');
    expect(searchTaskStatusLabel('')).toBe('');
    expect(searchTaskStatusLabel(null)).toBe('');
    expect(searchTaskStatusLabel(undefined)).toBe('');
  });

  it('the search route puts that word on the task row', () => {
    // WHY: a helper the route does not call still leaves in_progress on
    // the Siemens follow-up.
    const src = readFileSync(new URL('../routes/search.ts', import.meta.url), 'utf8');
    expect(src).toContain('searchTaskStatusLabel(t.status)');
    expect(src).not.toMatch(/subtitle:\s*t\.status/);
  });
});
