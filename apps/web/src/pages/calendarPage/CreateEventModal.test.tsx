// Regression coverage for the "New event" dialog's accessible name.
//
// Modal.tsx used to forward `label`/`labelId` straight onto RadixDialog.Content
// as raw aria-label/aria-labelledby attributes, without ever rendering an
// actual RadixDialog.Title. Radix keys its own a11y check (and the default
// aria-labelledby wiring) off a real <Title> element existing in the DOM, so
// every dialog built on Modal logged "DialogContent requires a DialogTitle
// for the component to be accessible for screen reader users" on open even
// though it visually had a name. Querying by role + accessible name — rather
// than just asserting an attribute string — fails if that Title element ever
// stops being rendered.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateEventModal } from './CreateEventModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('CreateEventModal accessibility', () => {
  afterEach(() => cleanup());

  it('exposes the dialog under its accessible name', () => {
    render(<CreateEventModal onClose={vi.fn()} onSave={vi.fn()} loading={false} />);

    expect(screen.getByRole('dialog', { name: 'Create calendar event' })).toBeTruthy();
  });

  it('does not leave a dangling aria-describedby (no Description is rendered)', () => {
    render(<CreateEventModal onClose={vi.fn()} onSave={vi.fn()} loading={false} />);

    // A stale aria-describedby pointing at a never-rendered id is the other
    // half of the same Radix warning ("Missing Description or
    // aria-describedby={undefined}"); Modal must suppress it explicitly.
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
  });
});
