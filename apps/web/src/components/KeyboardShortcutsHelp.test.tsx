import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

describe('KeyboardShortcutsHelp', () => {
  it('renders all shortcuts when open', () => {
    render(<KeyboardShortcutsHelp open={true} onOpenChange={() => {}} />);

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
    expect(screen.getByText('Command palette')).toBeDefined();
    expect(screen.getByText('⌘K / Ctrl+K')).toBeDefined();
    expect(screen.getByText('G then D')).toBeDefined();
    expect(screen.getByText('Go to Settings')).toBeDefined();
  });

  it('does not render dialog content when closed', () => {
    const { container } = render(<KeyboardShortcutsHelp open={false} onOpenChange={() => {}} />);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain('Keyboard shortcuts');
  });
});
