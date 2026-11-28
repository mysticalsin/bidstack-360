// The company detail used to send a note's title and drop its body. The
// MAPFRE demo debrief is one sentence; without it the Notes tab has nothing
// to say. The body has to leave the serializer with the title.
import { describe, expect, it } from 'vitest';

import { companyDetailNote } from './company-note.js';

const MAPFRE_BODY =
  'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform.';

describe('companyDetailNote', () => {
  it('keeps the demo note body next to the title', () => {
    const note = companyDetailNote({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Sample: MAPFRE IT steering debrief',
      bodyMd: MAPFRE_BODY,
      author: { name: 'Ada' },
      createdAt: new Date('2026-11-05T00:00:00.000Z'),
    });

    expect(note.title).toBe('Sample: MAPFRE IT steering debrief');
    expect(note.bodyMd).toBe(MAPFRE_BODY);
    expect(note.authorName).toBe('Ada');
    expect(note.createdAt).toBe('2026-11-05T00:00:00.000Z');
  });

  it('keeps a missing author as null and does not replace the body', () => {
    const note = companyDetailNote({
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Title only',
      bodyMd: '',
      author: null,
      createdAt: new Date('2026-11-05T00:00:00.000Z'),
    });

    expect(note.authorName).toBeNull();
    expect(note.bodyMd).toBe('');
  });
});
