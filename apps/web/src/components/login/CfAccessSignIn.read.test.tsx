// An Access session check that has not arrived is not an unavailable box.
// The sign-in card used the failure copy whenever failure was null, including
// the first paint and the in-flight /me read.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import { AuthProvider, useSignOut } from '@/lib/auth';

import { CfAccessSignIn } from './CfAccessSignIn';

const CHECKING = 'Checking your Cloudflare Access identity. The session has not arrived.';
const UNAVAILABLE = 'Polo is starting up or could not be reached. This usually clears within a minute.';
const REASON_403 =
  'Cloudflare Access verified your email, but it is not on the Polo access list. Ask a Polo admin to add it.';
const REASON_401 =
  'Polo did not receive your Cloudflare Access identity. Reload the page, or sign out of Cloudflare Access and sign in again.';
const SIGNED_IN = 'Your Cloudflare Access session is signed in.';
const SIGNED_OUT = 'You are signed out of Polo.';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function identityResponse() {
  return jsonResponse({
    dataMode: 'real',
    authProvider: 'cf-access',
    demoBanner: false,
    cfAccessEnabled: true,
  });
}

function meResponse(status: number, body: unknown) {
  return jsonResponse(body, status);
}

function renderSignIn() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider publishableKey={undefined}>
        <CfAccessSignIn />
        <SignOutProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function SignOutProbe() {
  const { signOut } = useSignOut();
  return (
    <button type="button" onClick={() => signOut()}>
      Sign out probe
    </button>
  );
}

function reasonText(): string {
  return screen.getByTestId('cf-access-reason').textContent ?? '';
}

describe('CfAccessSignIn session read', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AUTH_MODE', 'cf-access');
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('does not call an unread Access session check unavailable', () => {
    // WHY: the first paint has no /me payload. Unavailable is a failed read.
    // Signed out is a settled session. Neither has arrived.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    renderSignIn();

    expect(reasonText()).toBe(CHECKING);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
    expect(screen.queryByText(SIGNED_IN)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Data mode')).toBeNull();
  });

  it('does not call an in-flight Access session check unavailable', async () => {
    // WHY: once /me is on the wire, loaded is still false. A slow read is
    // not a box that could not be reached, and it is not a signed-out session.
    const fetchMock = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    renderSignIn();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(reasonText()).toBe(CHECKING);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByText('Data mode')).toBeNull();
  });

  it('keeps an allowlist refusal on the 403 reason', async () => {
    // WHY: a settled 403 is the access list, not a missing payload. The
    // refusal stays, and the checking line must not replace it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/me')) return meResponse(403, { message: 'not on the list' });
        if (url.includes('/identity')) return identityResponse();
        return jsonResponse({ ok: true });
      }),
    );
    renderSignIn();

    expect(await screen.findByText(REASON_403)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.getByText('real')).toBeTruthy();
  });

  it('keeps a missing Access identity on the 401 reason', async () => {
    // WHY: a settled 401 means Polo did not receive the Access identity.
    // That is not the unread line, and it is not the startup failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/me')) return meResponse(401, { message: 'missing identity' });
        if (url.includes('/identity')) return identityResponse();
        return jsonResponse({ ok: true });
      }),
    );
    renderSignIn();

    expect(await screen.findByText(REASON_401)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
  });

  it('keeps a non-retryable failure on the unavailable reason', async () => {
    // WHY: a settled failure that is not 401 or 403 still says the box could
    // not be reached. The checking line is only for a read that has not arrived.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/me')) return meResponse(400, { message: 'bad request' });
        if (url.includes('/identity')) return identityResponse();
        return jsonResponse({ ok: true });
      }),
    );
    renderSignIn();

    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
  });

  it('does not call a signed-in session unavailable', async () => {
    // WHY: a 200 /me is a session. The failure copy belongs to a failed read,
    // not to an identity that has already arrived.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/me')) {
          return meResponse(200, {
            id: 'user-ada',
            email: 'ada@example.test',
            name: 'Ada Lovelace',
            role: 'admin',
          });
        }
        if (url.includes('/identity')) return identityResponse();
        return jsonResponse({ ok: true });
      }),
    );
    renderSignIn();

    expect(await screen.findByText(SIGNED_IN)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(SIGNED_OUT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('does not call a settled sign-out unavailable', async () => {
    // WHY: sign-out clears the session after a successful read. Unavailable
    // would say the box could not be reached. The visitor is signed out.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/me')) {
          return meResponse(200, {
            id: 'user-ada',
            email: 'ada@example.test',
            name: 'Ada Lovelace',
            role: 'admin',
          });
        }
        if (url.includes('/identity')) return identityResponse();
        return jsonResponse({ ok: true });
      }),
    );
    renderSignIn();

    expect(await screen.findByText(SIGNED_IN)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out probe' }));
    expect(await screen.findByText(SIGNED_OUT)).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
