import { describe, expect, it } from 'vitest';

import { peopleImportPreview } from './people-import-preview.js';

const row = (name: string, title: string) => ({
  line: 2,
  name,
  title,
  email: null,
  phone: null,
  linkedinUrl: null,
  photoUrl: null,
});

describe('peopleImportPreview', () => {
  it('names the manager on a new CSV row and keeps an existing parent when the cell is blank', () => {
    // WHY: the dry-run tray is this list. A count alone is an empty tray.
    // A blank manager cell on someone who already reports to a person must
    // not move them to the top of the chart in the preview.
    const preview = peopleImportPreview(
      [
        {
          id: 'nora',
          isNew: true,
          parentId: null,
          row: { ...row('Nora Lee', 'VP Cloud'), line: 2 },
        },
        {
          id: 'omar',
          isNew: true,
          parentId: 'nora',
          row: { ...row('Omar Haddad', 'Director Data'), line: 3 },
        },
        {
          id: 'mina',
          isNew: false,
          parentId: undefined,
          row: { ...row('Mina Solano', 'Buyer'), line: 4 },
        },
      ],
      [{ id: 'mina', name: 'Mina Solano', parentId: 'nora' }],
      null,
    );

    expect(preview.map((person) => [person.name, person.manager, person.action])).toEqual([
      ['Nora Lee', null, 'create'],
      ['Omar Haddad', 'Nora Lee', 'create'],
      ['Mina Solano', 'Nora Lee', 'update'],
    ]);
    expect(preview.every((person) => person.hasPhoto === false)).toBe(true);
  });
});
