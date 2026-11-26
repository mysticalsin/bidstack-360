// The owner column is a claim about a person. An unread or failed roster has
// not produced that claim. "Unknown owner" is reserved for a roster that
// arrived and still does not contain the id.

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const useUsersMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useUsers', () => ({ useUsers: useUsersMock }));

import { useOwnerLabel } from './proposals-columns';

function roster(state: {
  data?: Array<{ id: string; name: string | null; email: string }>;
  isPending?: boolean;
  isError?: boolean;
}) {
  useUsersMock.mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  });
}

describe('useOwnerLabel when the roster has not arrived', () => {
  beforeEach(() => {
    useUsersMock.mockReset();
  });

  it('says the owner is being checked while the roster is still loading', () => {
    // WHY: the desk was labeling every owned proposal "Unknown owner" for the
    // whole cold load. That reads as a missing person, so someone reassigns
    // work the directory has not named yet.
    roster({ isPending: true });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current('user-1')).toBe('Checking the owner');
  });

  it('says the roster has not arrived when the owner read fails', () => {
    // WHY: a failed directory read is not evidence the owner is unknown. The
    // proposal still has an owner. The name just did not get here.
    roster({ isError: true });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current('user-1')).toBe(
      'Could not load the owner. The roster has not arrived.',
    );
  });

  it('names an owner the loaded roster contains, including a blank display name', () => {
    roster({
      data: [
        { id: 'user-1', name: 'Ada Owner', email: 'ada@example.com' },
        { id: 'user-3', name: null, email: 'nameless@example.com' },
      ],
    });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current('user-1')).toBe('Ada Owner');
    expect(result.current('user-3')).toBe('nameless@example.com');
    expect(useUsersMock).toHaveBeenCalledWith({ limit: 200, includeDeleted: true });
  });

  it('says unknown only after a loaded roster misses the id', () => {
    roster({ data: [{ id: 'user-2', name: 'Bea Owner', email: 'bea@example.com' }] });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current('user-1')).toBe('Unknown owner');
  });

  it('leaves an unassigned proposal unlabeled', () => {
    roster({ data: [{ id: 'user-2', name: 'Bea Owner', email: 'bea@example.com' }] });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current(null)).toBeNull();
  });

  it('keeps a cached name when a later roster read fails', () => {
    roster({
      data: [{ id: 'user-1', name: 'Ada Owner', email: 'ada@example.com' }],
      isError: true,
    });
    const { result } = renderHook(() => useOwnerLabel());
    expect(result.current('user-1')).toBe('Ada Owner');
  });
});
