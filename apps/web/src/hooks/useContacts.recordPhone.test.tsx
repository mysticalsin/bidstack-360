// The contact record dials tel: of the phone in the ['contact', id] cache.
// The list cache is a different key, so a saved phone can land on the row
// and leave Klaus Vogt's open record calling +49 30 1234 5670.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import type { Contact } from '@bidstack/shared';

import { useUpdateContact } from './useContacts';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const KLAUS = '11111111-1111-4111-8111-111111111111';
const LENA = '22222222-2222-4222-8222-222222222222';
const SEEDED_KLAUS = '+49 30 1234 5670';
const SEEDED_LENA = '+49 30 1234 5671';
const SAVED = '+49 30 9999 0001';

function person(id: string, name: string, phone: string): Contact {
  return {
    id,
    customer: 'Siemens',
    name,
    role: name === 'Klaus Vogt' ? 'VP Operations' : 'IT Director',
    email:
      name === 'Klaus Vogt' ? 'klaus.vogt.demo@example.com' : 'lena.fischer.demo@example.com',
    phone,
    influence: name === 'Klaus Vogt' ? 5 : 4,
    sentiment: name === 'Klaus Vogt' ? 'hot' : 'warm',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: null,
    linkState: 'linked',
    customFieldValues: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        definitionId: '44444444-4444-4444-8444-444444444444',
        value: 'kept',
      },
    ],
  };
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const klaus = person(KLAUS, 'Klaus Vogt', SEEDED_KLAUS);
  const lena = person(LENA, 'Lena Fischer', SEEDED_LENA);
  queryClient.setQueryData(['contacts', { limit: 50 }], {
    items: [klaus, lena],
    nextCursor: null,
  });
  queryClient.setQueryData(['contact', KLAUS], klaus);
  queryClient.setQueryData(['contact', LENA], lena);
  return { queryClient, wrapper, klaus, lena };
}

function recordPhone(queryClient: QueryClient, id: string): string | null | undefined {
  return queryClient.getQueryData<Contact>(['contact', id])?.phone;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateContact record phone', () => {
  it('moves the open record onto the phone the list just saved', async () => {
    // WHY: Klaus Vogt's record dials the cached phone. Saving +49 30 9999 0001
    // on the list has to replace +49 30 1234 5670 there, or the call stays on
    // the seeded line. Lena Fischer's record is a different person.
    const { queryClient, wrapper } = createHarness();
    vi.mocked(api).mockResolvedValue({ id: KLAUS, phone: SAVED });
    const { result } = renderHook(() => useUpdateContact(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: KLAUS, patch: { phone: SAVED } });
    });

    expect(recordPhone(queryClient, KLAUS)).toBe(SAVED);
    expect(recordPhone(queryClient, LENA)).toBe(SEEDED_LENA);
    expect(
      queryClient.getQueryData<Contact>(['contact', KLAUS])?.customFieldValues?.[0]?.value,
    ).toBe('kept');
    const list = queryClient.getQueryData<{ items: Contact[] }>(['contacts', { limit: 50 }]);
    expect(list?.items.find((c) => c.id === KLAUS)?.phone).toBe(SAVED);
  });

  it('puts the seeded phone back when the save is refused', async () => {
    // WHY: an optimistic call number the server rejects must not stay on the
    // record. The dial would then use a phone that was never stored.
    const { queryClient, wrapper } = createHarness();
    let rejectSave: (reason?: unknown) => void = () => {};
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const { result } = renderHook(() => useUpdateContact(), { wrapper });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.mutateAsync({ id: KLAUS, patch: { phone: SAVED } });
    });

    await waitFor(() => expect(recordPhone(queryClient, KLAUS)).toBe(SAVED));
    rejectSave(new Error('Contact not found'));
    await expect(pending).rejects.toThrow('Contact not found');
    expect(recordPhone(queryClient, KLAUS)).toBe(SEEDED_KLAUS);
    expect(recordPhone(queryClient, LENA)).toBe(SEEDED_LENA);
  });
});
