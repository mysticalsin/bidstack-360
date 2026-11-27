// New leads sit at 7 days when the org has no override. Clearing the field
// used to parse as 0, 400 used to clamp to 365, and 8.9 used to floor to 8.
// None of those counts was typed. An empty field is not zero.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
    },
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const rotMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/hooks/useLeadRot', () => ({
  useLeadRotConfig: () => ({
    data: { items: [] },
    isLoading: false,
  }),
  useUpsertLeadRotConfig: () => ({
    mutateAsync: rotMocks.mutateAsync,
  }),
}));

import { LeadRotSection } from './LeadRotSection';

function daysInput(status: string): HTMLInputElement {
  return screen.getByRole('spinbutton', { name: `Rotten days for ${status}` });
}

describe('LeadRotSection days', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves a whole day count the admin typed', () => {
    render(<LeadRotSection />);
    fireEvent.change(daysInput('New'), { target: { value: '10' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(rotMocks.mutateAsync).toHaveBeenCalledWith({ status: 'new', rottenDays: 10 });
  });

  it('does not save a day count the field invented', () => {
    // WHY: a cleared New threshold is not 0 days, 400 is not 365, 8.9 is not
    // 8, and -1 is not 0. Those writes would mark a fresh lead rotten, or
    // store a count the admin never typed. A typed 0 is still a real count.
    render(<LeadRotSection />);

    fireEvent.change(daysInput('New'), { target: { value: '' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/0 to 365/);

    fireEvent.change(daysInput('New'), { target: { value: '400' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(daysInput('New'), { target: { value: '8.9' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(daysInput('New'), { target: { value: '-1' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(daysInput('New'), { target: { value: '0' } });
    fireEvent.blur(daysInput('New'));
    expect(rotMocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(rotMocks.mutateAsync).toHaveBeenCalledWith({ status: 'new', rottenDays: 0 });
  });
});
