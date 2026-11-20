import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

const intel = vi.hoisted(() => ({
  data: undefined as
    | { extractions: { documentId: string; status: string; error: string | null }[] }
    | undefined,
}));

vi.mock('@/hooks/useAccountIntel', () => ({
  useAccountIntel: () => ({ data: intel.data }),
  useExtractDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('./intake/ReceiveStep', () => ({
  ReceiveStep: ({ onNext }: { onNext: () => void }) => (
    <button type="button" onClick={onNext}>
      Receive body next
    </button>
  ),
}));
vi.mock('./intake/ExtractStep', () => ({
  ExtractStep: () => <p>Extract body</p>,
}));
vi.mock('./intake/ReviewStep', () => ({ ReviewStep: () => <p>Review body</p> }));
vi.mock('./intake/PublishStep', () => ({ PublishStep: () => <p>Publish body</p> }));

import { IntakePage } from './IntakePage';

function step(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^\\d ${name}$`) });
}

describe('IntakePage stepper', () => {
  afterEach(() => {
    cleanup();
    intel.data = undefined;
  });

  it('resumes review from persisted extractions after a reload', () => {
    intel.data = { extractions: [{ documentId: 'doc-1', status: 'done', error: null }] };
    render(
      <MemoryRouter initialEntries={['/intake?account=acc-1']}>
        <IntakePage />
      </MemoryRouter>,
    );
    expect((step('Review') as HTMLButtonElement).disabled).toBe(false);
    expect((step('Publish') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(step('Review'));
    expect(screen.getByText('Review body')).toBeTruthy();
  });

  it('keeps review locked when the account has no finished extraction', () => {
    intel.data = { extractions: [{ documentId: 'doc-1', status: 'error', error: 'boom' }] };
    render(
      <MemoryRouter initialEntries={['/intake?account=acc-1']}>
        <IntakePage />
      </MemoryRouter>,
    );
    expect((step('Review') as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the current step and does not let you skip ahead', () => {
    render(
      <MemoryRouter initialEntries={['/intake']}>
        <IntakePage />
      </MemoryRouter>,
    );
    expect(step('Receive').getAttribute('aria-current')).toBe('step');
    expect((step('Receive') as HTMLButtonElement).disabled).toBe(true);
    for (const name of ['Extract', 'Review', 'Publish']) {
      expect((step(name) as HTMLButtonElement).disabled, name).toBe(true);
    }
    fireEvent.click(step('Publish'));
    expect(screen.queryByText('Publish body')).toBeNull();
  });

  it('lets you return to a step you already reached', () => {
    render(
      <MemoryRouter initialEntries={['/intake']}>
        <IntakePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Receive body next' }));
    expect(screen.getByText('Extract body')).toBeTruthy();
    expect(step('Extract').getAttribute('aria-current')).toBe('step');
    expect((step('Receive') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(step('Receive'));
    expect(screen.getByRole('button', { name: 'Receive body next' })).toBeTruthy();
    expect((step('Extract') as HTMLButtonElement).disabled).toBe(false);
  });
});
