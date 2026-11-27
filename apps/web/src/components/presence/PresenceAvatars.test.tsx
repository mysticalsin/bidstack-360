// PresenceAvatars — rendering contract for the "who's in this bid" stack.
//
// WHY these assertions matter: overflow math and self-exclusion are the two
// ways this UI can quietly lie. A wrong "+N" undercounts/overcounts real
// collaborators; showing the viewer their own avatar reads as "you are a
// collaborator on yourself," which erodes trust in the whole signal (same
// rationale as the hook-level exclusion — this is the defensive second
// layer described in the component's file header).
//
// No jest-dom matchers here — this repo's vitest config has no setupFiles
// registering them (see DueDateChip.test.tsx for the same plain-assertion
// convention), so we query the DOM directly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { PresenceAvatars } from './PresenceAvatars';
import { usePresence } from '@/hooks/usePresence';
import { useUser } from '@/lib/auth';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/usePresence', () => ({ usePresence: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useUser: vi.fn() }));

const SELF_ID = 'user-self';
const DEMO_TOKEN_KEY = 'bidstack:demo-token';
const DEMO_SESSION_USER_ID = '33333333-3333-4333-8333-333333333333';

function demoSessionToken(userId: string): string {
  const json = JSON.stringify({
    u: userId,
    o: '22222222-2222-4222-8222-222222222222',
    exp: 4_000_000_000,
  });
  const body = btoa(json).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  return `demo_${body}.not-a-signature`;
}

function viewer(id: string, name: string) {
  return { userId: id, userName: name, lastSeenAt: new Date().toISOString() };
}

function mockSelf(): void {
  vi.mocked(useUser).mockReturnValue({
    user: {
      id: SELF_ID,
      firstName: 'Self',
      lastName: 'User',
      fullName: 'Self User',
      primaryEmailAddress: null,
    },
  });
}

afterEach(() => {
  localStorage.removeItem(DEMO_TOKEN_KEY);
  cleanup();
  vi.clearAllMocks();
});

describe('PresenceAvatars', () => {
  it('renders nothing when no one else is viewing (absence, not a zero badge)', () => {
    mockSelf();
    vi.mocked(usePresence).mockReturnValue({ viewers: [], isLoading: false });

    const { container } = render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('avatar-stack')).toBeNull();
  });

  it('excludes self even if the viewer list includes the caller (defense in depth)', () => {
    mockSelf();
    vi.mocked(usePresence).mockReturnValue({
      viewers: [viewer(SELF_ID, 'Self User')],
      isLoading: false,
    });

    const { container } = render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    // The only "viewer" was self — the stack must render nothing, not a self-avatar.
    expect(container.firstChild).toBeNull();
  });

  it('shows up to 4 avatars and rolls the rest into a "+N" overflow badge', () => {
    mockSelf();
    vi.mocked(usePresence).mockReturnValue({
      viewers: [
        viewer('u2', 'Bob'),
        viewer('u3', 'Cara'),
        viewer('u4', 'Dee'),
        viewer('u5', 'Eli'),
        viewer('u6', 'Fay'),
      ],
      isLoading: false,
    });

    render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    const stack = screen.getByTestId('avatar-stack');
    expect(stack).toBeDefined();
    // 5 viewers, max 4 shown -> 1 overflow.
    expect(screen.getByText('+1')).toBeDefined();
    expect(stack.getAttribute('aria-label')).toBe('5 people viewing');
  });

  it('excludes self from the overflow count too', () => {
    mockSelf();
    vi.mocked(usePresence).mockReturnValue({
      viewers: [
        viewer(SELF_ID, 'Self User'),
        viewer('u2', 'Bob'),
        viewer('u3', 'Cara'),
        viewer('u4', 'Dee'),
        viewer('u5', 'Eli'),
      ],
      isLoading: false,
    });

    render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    // 4 real others after excluding self — exactly `max`, so no overflow badge.
    expect(screen.getByTestId('avatar-stack').getAttribute('aria-label')).toBe('4 people viewing');
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it('renders nothing for the signed-in demo person and still shows a teammate', () => {
    // WHY: the second self-filter has to use the session uuid, not only
    // useUser().id. Demo auth reports "demo-user", so a raw viewer list
    // that includes the session user would otherwise draw that person as
    // a collaborator on a bid they are viewing alone.
    localStorage.setItem(DEMO_TOKEN_KEY, demoSessionToken(DEMO_SESSION_USER_ID));
    vi.mocked(useUser).mockReturnValue({
      user: {
        id: 'demo-user',
        firstName: null,
        lastName: null,
        fullName: 'Demo User',
        primaryEmailAddress: null,
      },
    });
    vi.mocked(usePresence).mockReturnValue({
      viewers: [viewer(DEMO_SESSION_USER_ID, 'Demo Visitor'), viewer('u2', 'A Teammate')],
      isLoading: false,
    });

    render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    expect(screen.getByTestId('avatar-stack').getAttribute('aria-label')).toBe('1 person viewing');
  });

  it('renders one avatar with no overflow badge for a single other viewer', () => {
    mockSelf();
    vi.mocked(usePresence).mockReturnValue({
      viewers: [viewer('u2', 'Bob')],
      isLoading: false,
    });

    render(<PresenceAvatars entityType="opportunity" entityId="opp-1" />);

    expect(screen.getByTestId('avatar-stack').getAttribute('aria-label')).toBe('1 person viewing');
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });
});
