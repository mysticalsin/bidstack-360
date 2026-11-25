import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const localesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public/locales');

function authSubtitle(locale: string): string {
  const auth = JSON.parse(readFileSync(path.join(localesDir, locale, 'auth.json'), 'utf8')) as {
    demoSignIn?: { subtitle?: string };
  };
  return auth.demoSignIn?.subtitle ?? '';
}

// Why these phrases: the public demo is a seeded sandbox that resets. A
// subtitle that says the book is real, or the pipeline is live, is the
// sentence a visitor reads before they type an email.
const SAMPLE_SANDBOX: Record<string, { avoid: RegExp[]; keep: RegExp }> = {
  en: {
    avoid: [/real accounts/i, /live pipeline/i],
    keep: /sample accounts, a sample pipeline[\s\S]*private sandbox/i,
  },
  fr: {
    avoid: [/vrais comptes/i, /pipeline en direct/i],
    keep: /comptes d'exemple[\s\S]*pipeline d'exemple[\s\S]*bac à sable/i,
  },
  es: {
    avoid: [/cuentas reales/i, /pipeline en vivo/i],
    keep: /cuentas de ejemplo[\s\S]*pipeline de ejemplo[\s\S]*entorno aislado/i,
  },
  pt: {
    avoid: [/contas reais/i, /pipeline ao vivo/i],
    keep: /contas de exemplo[\s\S]*pipeline de exemplo[\s\S]*ambiente isolado/i,
  },
  it: {
    avoid: [/account reali/i, /tempo reale/i],
    keep: /account di esempio[\s\S]*pipeline di esempio[\s\S]*ambiente isolato/i,
  },
  zh: {
    avoid: [/真实客户/, /实时管道/],
    keep: /示例客户[\s\S]*示例管道[\s\S]*隔离沙盒/,
  },
};

const apiMock = vi.hoisted(() => vi.fn());
const signInMock = vi.hoisted(() => vi.fn((done: () => void) => done()));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth', () => ({
  DEMO_TOKEN_KEY: 'demo-token',
  DEMO_EMAIL_KEY: 'demo-email',
  DEMO_SIGNED_OUT_KEY: 'demo-signed-out',
  useSignInAction: () => ({ signIn: signInMock }),
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

import { DemoSignIn } from './DemoSignIn';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();
const routes = new Map<string, Response[]>();

function route(path: string, ...responses: Response[]) {
  routes.set(path, responses);
}

function authCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/__auth/')) as [string, RequestInit][];
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoSignIn />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  routes.clear();
  fetchMock.mockImplementation(async (url: string) => {
    const queue = routes.get(String(url));
    return queue?.shift() ?? new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  });
  apiMock.mockReset();
  signInMock.mockClear();
  navigateMock.mockClear();
  apiMock.mockResolvedValue({ token: 't', email: 'tony@example.com', orgId: 'o' });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DemoSignIn', () => {
  it('signs a Cloudflare-verified visitor straight in, with no email form', async () => {
    route('/__auth/me', jsonResponse(200, { email: 'tony@example.com', via: 'access' }));
    renderPage();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/demo/session', {
        method: 'POST',
        body: { email: 'tony@example.com' },
      }),
    );
    expect(screen.queryByLabelText('Work email')).toBeNull();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(localStorage.getItem('bidstack:session')).toBe('demo');
  });

  it('keeps the email form when not behind the Worker (HTML fallback)', async () => {
    route('/__auth/me', new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    renderPage();
    const input = await screen.findByLabelText('Work email');
    fireEvent.change(input, { target: { value: 'someone@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter the demo/ }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/api/v1/demo/session', {
        method: 'POST',
        body: { email: 'someone@example.com' },
      }),
    );
    expect(authCalls()).toHaveLength(1);
  });

  it('emails a one-time code, then signs in with it', async () => {
    route('/__auth/me', jsonResponse(401, { otp: true }));
    route('/__auth/code', jsonResponse(202, { sent: true }));
    route('/__auth/verify', jsonResponse(200, { email: 'tony@example.com' }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Work email'), {
      target: { value: 'tony@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/ }));

    const code = await screen.findByPlaceholderText('6-digit code');
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '12a3456' } });
    expect((code as HTMLInputElement).value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const [, sendInit] = authCalls()[1];
    const [verifyUrl, verifyInit] = authCalls()[2];
    expect(JSON.parse(String(sendInit.body))).toEqual({ email: 'tony@example.com' });
    expect(verifyUrl).toBe('/__auth/verify');
    expect(JSON.parse(String(verifyInit.body))).toEqual({ email: 'tony@example.com', code: '123456' });
  });

  it('does not sign back in after an explicit sign-out, and enters only when asked', async () => {
    localStorage.setItem('demo-signed-out', '1');
    route('/__auth/me', jsonResponse(200, { email: 'tony@example.com', via: 'access' }));
    renderPage();
    const input = (await screen.findByLabelText('Work email')) as HTMLInputElement;
    expect(input.value).toBe('tony@example.com');
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Enter the demo/ }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('demo-signed-out')).toBeNull();
  });

  it('treats a failed gate check as unknown and rechecks before choosing the flow', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/__auth/me') {
        calls += 1;
        if (calls === 1) throw new TypeError('network');
        return jsonResponse(401, { otp: true });
      }
      if (url === '/__auth/code') return jsonResponse(202, { sent: true });
      return jsonResponse(404, {});
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: 'tony@example.com' } });
    expect(screen.getByRole('status').textContent).toContain('Could not check sign-in.');
    expect(screen.getByRole('button', { name: 'Retry' }).className).toContain('min-h-11');
    fireEvent.click(screen.getByRole('button', { name: /Enter the demo/ }));
    expect(await screen.findByPlaceholderText('6-digit code')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
    expect(authCalls().map(([u]) => u)).toEqual(['/__auth/me', '/__auth/me', '/__auth/code']);
  });

  it('keeps the visitor on the form with an error when the recheck also fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('network');
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Work email'), { target: { value: 'tony@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Enter the demo/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not check sign-in. Check your connection and try again.',
    );
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('says so when the code is wrong and does not enter', async () => {
    route('/__auth/me', jsonResponse(401, { otp: true }));
    route('/__auth/code', jsonResponse(202, { sent: true }));
    route('/__auth/verify', jsonResponse(401, { error: 'wrong_code' }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Work email'), {
      target: { value: 'tony@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a code/ }));
    fireEvent.change(await screen.findByPlaceholderText('6-digit code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('That code is wrong or expired.');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('names the demo door a sample sandbox instead of a live book', async () => {
    route('/__auth/me', new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    renderPage();
    await screen.findByLabelText('Work email');
    const subtitle = screen.getByText(/sample accounts, a sample pipeline/i);
    expect(subtitle.textContent).toBe(authSubtitle('en'));
    expect(subtitle.textContent).toMatch(SAMPLE_SANDBOX.en!.keep);
    for (const claim of SAMPLE_SANDBOX.en!.avoid) {
      expect(subtitle.textContent).not.toMatch(claim);
    }
  });

  it('keeps every shipped language on that same sample sandbox', () => {
    for (const [locale, rule] of Object.entries(SAMPLE_SANDBOX)) {
      const subtitle = authSubtitle(locale);
      expect(subtitle.length, locale).toBeGreaterThan(0);
      expect(subtitle, locale).toMatch(rule.keep);
      for (const claim of rule.avoid) {
        expect(subtitle, locale).not.toMatch(claim);
      }
    }
    expect(authSubtitle('ar')).toBe('');
  });
});
