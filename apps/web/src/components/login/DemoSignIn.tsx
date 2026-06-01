import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '@/lib/api';
import { DEMO_TOKEN_KEY, DEMO_EMAIL_KEY, useSignInAction } from '@/lib/auth';

/**
 * Demo sign-in card (VITE_AUTH_MODE=demo). Passwordless: POST an email to
 * /api/v1/demo/session, store the returned signed Bearer token, then flip auth
 * state and enter the app. Each email gets its own freshly-seeded workspace.
 */
interface DemoSessionResponse {
  token: string;
  email: string;
  orgId: string;
}

export function DemoSignIn() {
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || email.trim().length === 0) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api<DemoSessionResponse>('/api/v1/demo/session', {
        method: 'POST',
        body: { email: email.trim() },
      });
      localStorage.setItem(DEMO_TOKEN_KEY, res.token);
      localStorage.setItem(DEMO_EMAIL_KEY, res.email);
      localStorage.setItem('bidstack:session', 'demo');
      signIn(() => navigate('/dashboard', { replace: true }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not start the demo. Please try again in a moment.',
      );
      setLoading(false);
    }
  }

  return (
    <div className="relative z-[100] flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/40 bg-white/80 p-8 shadow-xl backdrop-blur-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-primary)]">
            Live demo
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Explore BidStack 360°
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter any email to get your own private demo workspace — no password, no signup.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="demo-email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="demo-email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={loading}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'demo-error' : undefined}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-400 focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 disabled:opacity-60"
            />
          </div>

          {error ? (
            <p id="demo-error" role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading || email.trim().length === 0}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 font-medium text-white transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Setting up your workspace…' : 'Enter the demo'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-500">
          A sandbox workspace pre-filled with sample accounts, opportunities, and RFPs. Resets
          periodically.
        </p>
      </div>
    </div>
  );
}
