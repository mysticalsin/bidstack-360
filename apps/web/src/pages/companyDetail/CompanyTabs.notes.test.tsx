// The company Notes tab used to print the title and the author and drop the
// body. On the demo seed that hides the only sentence the note exists to
// carry (MAPFRE's steering debrief). A title-only card is not the note.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotesTab } from './CompanyTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const MAPFRE_BODY =
  'The MAPFRE CIO office said our delivery quality is better than Accenture on the claims platform.';

afterEach(() => {
  cleanup();
});

describe('CompanyTabs — NotesTab body', () => {
  it('shows the demo note body with the title, not the title alone', () => {
    render(
      <NotesTab
        notes={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Sample: MAPFRE IT steering debrief',
            authorName: 'Ada',
            createdAt: '2026-11-05T00:00:00.000Z',
            bodyMd: MAPFRE_BODY,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Sample: MAPFRE IT steering debrief' })).toBeTruthy();
    expect(screen.getByText(MAPFRE_BODY)).toBeTruthy();
  });

  it('does not invent a blank body line when the note has no text', () => {
    render(
      <NotesTab
        notes={[
          {
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Title only',
            authorName: null,
            createdAt: '2026-11-05T00:00:00.000Z',
            bodyMd: '   ',
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Title only' })).toBeTruthy();
    expect(screen.queryByText(/^\s+$/)).toBeNull();
  });
});
