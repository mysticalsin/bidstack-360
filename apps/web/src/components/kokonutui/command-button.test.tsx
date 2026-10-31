import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CommandButton from './command-button';

describe('CommandButton (kokonutui, Polo tones)', () => {
  it('clicks on its shortcut, keeps the accessible name clean, and ignores typing', () => {
    const onClick = vi.fn();
    render(
      <>
        <input aria-label="notes" />
        <CommandButton tone="primary" shortcut="shift+b" onClick={onClick}>Generate brief</CommandButton>
      </>,
    );
    const btn = screen.getByRole('button', { name: 'Generate brief' });
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Shift+B');
    fireEvent.keyDown(window, { key: 'B', code: 'KeyB', shiftKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'B', code: 'KeyB', shiftKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
