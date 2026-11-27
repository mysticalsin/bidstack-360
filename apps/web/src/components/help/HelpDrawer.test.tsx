// The ? drawer is the only shortcut map a demo user can open. It has to name
// the global keys that actually fire, and it must not teach record keys that
// do not. Up, Down, Enter, E, and Del are not app-wide: pressing them on the
// seeded workspace does nothing. Ctrl or Command slash focuses the topbar
// search, and Ctrl or Command J opens Jarvis. The English catalog is what
// production renders, so a stale "Delete with confirmation" string there
// would put the lie back on screen.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { HelpDrawer } from './HelpDrawer';
import { useHelpDrawer } from './useHelpDrawer';

const EN_COMMON = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../public/locales/en/common.json',
);

describe('HelpDrawer shortcut map', () => {
  beforeEach(() => {
    useHelpDrawer.setState({ open: true });
  });

  afterEach(() => {
    useHelpDrawer.setState({ open: false });
  });

  it('names search and Jarvis, and does not teach record keys that do nothing', () => {
    render(<HelpDrawer />);

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('Focus search')).toBeDefined();
    expect(screen.getByText('⌘/ / Ctrl+/')).toBeDefined();
    expect(screen.getByText('Open Jarvis')).toBeDefined();
    expect(screen.getByText('⌘J / Ctrl+J')).toBeDefined();
    expect(screen.getByText('⌘K / Ctrl+K')).toBeDefined();
    expect(screen.getByText('Go to Accounts')).toBeDefined();
    expect(screen.getByText('Go to Search')).toBeDefined();
    expect(screen.getByText(/Letter shortcuts pause inside a text field/)).toBeDefined();

    expect(screen.queryByRole('heading', { name: 'Records' })).toBeNull();
    expect(screen.queryByText('Move selection in lists')).toBeNull();
    expect(screen.queryByText('Open record')).toBeNull();
    expect(screen.queryByText('Edit selected record')).toBeNull();
    expect(screen.queryByText('Delete with confirmation')).toBeNull();
    expect(screen.queryByText(/except inside text fields/)).toBeNull();
  });

  it('keeps the English catalog on the same map the drawer renders', () => {
    const catalog = JSON.parse(readFileSync(EN_COMMON, 'utf8')) as {
      helpDrawer: Record<string, string>;
    };
    const help = catalog.helpDrawer;

    expect(help.focusSearch).toBe('Focus search');
    expect(help.openJarvis).toBe('Open Jarvis');
    expect(help.footer).toMatch(/Letter shortcuts pause inside a text field/);
    expect(help.footer).not.toMatch(/except inside text fields/);
    expect(help.groupRecords).toBeUndefined();
    expect(help.moveSelectionInLists).toBeUndefined();
    expect(help.openRecord).toBeUndefined();
    expect(help.editSelectedRecord).toBeUndefined();
    expect(help.deleteWithConfirmation).toBeUndefined();
  });
});
