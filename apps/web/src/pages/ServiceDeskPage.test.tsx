// WHY: sweep 09 found the service desk empty state was a title and nothing
// else. A person with no cases needs a sentence and a way to open one.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useServiceCases', () => ({
  useServiceCases: () => ({ data: { items: [], nextCursor: null }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateServiceCase: () => ({ mutate: create, isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

import { ServiceDeskPage } from './ServiceDeskPage';

afterEach(() => {
  cleanup();
  create.mockReset();
});

describe('ServiceDeskPage empty state', () => {
  it('explains the empty list and opens a case from the subject the person types', () => {
    render(<ServiceDeskPage />);
    expect(screen.getByText(/track a customer request/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /new case/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /case subject/i }), {
      target: { value: 'Synthetic follow-up' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save case/i }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Synthetic follow-up', status: 'new', source: 'web' }),
      expect.anything(),
    );
  });
});
