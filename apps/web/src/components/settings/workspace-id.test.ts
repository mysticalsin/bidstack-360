import { describe, expect, it } from 'vitest';

import { displayWorkspaceId } from './workspace-id';

// An unset local env used to fall back to the vendor slug, so a new company's
// Profile & Security card claimed the workspace was mantu-presales.
describe('displayWorkspaceId', () => {
  it('does not invent the vendor slug when no workspace id is configured', () => {
    expect(displayWorkspaceId(undefined)).toBe('Not configured');
    expect(displayWorkspaceId('')).toBe('Not configured');
    expect(displayWorkspaceId('   ')).toBe('Not configured');
  });

  it('shows an id the operator actually set', () => {
    expect(displayWorkspaceId('harbor-synthetic')).toBe('harbor-synthetic');
  });
});
