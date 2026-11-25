import { describe, expect, it } from 'vitest';

import { notesListPath } from './useNotes';

const MAPFRE = '11111111-1111-4111-8111-111111111111';

describe('notesListPath', () => {
  it('adds companyId so a linked contact reads notes filed on the company, not only the display name', () => {
    expect(notesListPath(MAPFRE, MAPFRE)).toBe(
      `/api/notes?accountId=${MAPFRE}&companyId=${MAPFRE}`,
    );
  });

  it('leaves a name-only read unchanged', () => {
    expect(notesListPath('Globex')).toBe('/api/notes?accountId=Globex');
  });
});
