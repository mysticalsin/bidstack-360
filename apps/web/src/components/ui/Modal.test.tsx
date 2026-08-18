// Modal is the shared primitive behind the "New event", "New Custom Object",
// and template-picker dialogs. It used to accept a `labelId`/`label` pair and
// forward them straight onto RadixDialog.Content as aria-labelledby/aria-label
// — Radix never saw an actual RadixDialog.Title, so it logged "DialogContent
// requires a DialogTitle for the component to be accessible for screen reader
// users" (plus a missing-Description warning) on every open. These tests pin
// the fix: a real Title backs the accessible name, and no dangling
// aria-describedby is left behind.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal';

describe('Modal accessibility', () => {
  afterEach(() => cleanup());

  it('exposes the dialog under the given title via a real DialogTitle', () => {
    render(
      <Modal open onClose={vi.fn()} title="Example dialog">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Example dialog' })).toBeTruthy();
  });

  it('does not set aria-describedby when there is no description', () => {
    render(
      <Modal open onClose={vi.fn()} title="Example dialog">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
  });
});
