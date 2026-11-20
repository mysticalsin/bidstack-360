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

describe('CreateEventModal time zone', () => {
  afterEach(() => cleanup());

  it('creates the event at the clicked wall time in the calendar time zone', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const onSave = vi.fn();
    render(
      <CreateEventModal
        onClose={vi.fn()}
        onSave={onSave}
        loading={false}
        initialDayKey="2026-11-09"
        initialHour={21}
        timeZone="America/Toronto"
      />,
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Late call' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form') as HTMLFormElement);

    const body = onSave.mock.calls[0]?.[0] as { startAt: string; endAt: string; clientRequestId?: string };
    // 21:00 Toronto on 9 Nov is 02:00 UTC on 10 Nov, not a UTC-shifted date.
    expect(body.startAt).toBe('2026-11-10T02:00:00.000Z');
    expect(body.endAt).toBe('2026-11-10T02:30:00.000Z');
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses an end time before the start time', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const onSave = vi.fn();
    render(<CreateEventModal onClose={vi.fn()} onSave={onSave} loading={false} timeZone="America/Toronto" />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '09:00' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form') as HTMLFormElement);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/end/i);
  });
});
