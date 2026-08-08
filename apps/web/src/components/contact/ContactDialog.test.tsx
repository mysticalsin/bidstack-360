import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// POST/PATCH /api/contacts are gated server-side behind contacts:write
// (apps/api/src/routes/contacts.ts). This dialog opens from read-only paths
// too (row Edit, context menu), so it must disable Save/Create with a hint
// instead of dead-ending in a 403 after the form is filled out.
const hookMocks = vi.hoisted(() => ({
  canWrite: true,
  createMutateAsync: vi.fn(),
  updateMutateAsync: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => hookMocks.canWrite,
}));

vi.mock('@/hooks/useContacts', () => ({
  useCreateContact: () => ({ mutateAsync: hookMocks.createMutateAsync, isPending: false }),
  useUpdateContact: () => ({ mutateAsync: hookMocks.updateMutateAsync, isPending: false }),
}));

import { ContactDialog } from './ContactDialog';

describe('ContactDialog — contacts:write gating', () => {
  afterEach(() => {
    cleanup();
    hookMocks.canWrite = true;
    hookMocks.createMutateAsync.mockClear();
    hookMocks.updateMutateAsync.mockClear();
  });

  it('disables Create contact and explains why for a user without contacts:write', () => {
    hookMocks.canWrite = false;
    render(<ContactDialog open onOpenChange={vi.fn()} />);

    const submit = screen.getByRole('button', { name: /create contact/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/need contacts write access/i)).toBeTruthy();
  });

  it('keeps Create contact enabled for a user with contacts:write', () => {
    hookMocks.canWrite = true;
    render(<ContactDialog open onOpenChange={vi.fn()} />);

    const submit = screen.getByRole('button', { name: /create contact/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(screen.queryByText(/need contacts write access/i)).toBeNull();
  });

  it('disables Save changes in edit mode for a user without contacts:write', () => {
    hookMocks.canWrite = false;
    render(
      <ContactDialog
        open
        onOpenChange={vi.fn()}
        contact={{
          id: '11111111-1111-4111-8111-111111111111',
          customer: 'Acme Corp',
          name: 'Jane Doe',
          role: 'CTO',
          email: 'jane@acme.com',
          phone: null,
          influence: 4,
          sentiment: 'warm',
          createdAt: new Date().toISOString(),
        }}
      />,
    );

    const submit = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
