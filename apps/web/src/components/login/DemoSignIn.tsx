import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, ApiError } from '@/lib/api';
import { DEMO_TOKEN_KEY, DEMO_EMAIL_KEY, DEMO_SIGNED_OUT_KEY, useSignInAction } from '@/lib/auth';
import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';

/**
 * Demo sign-in (VITE_AUTH_MODE=demo) rendered as the full branded login.
 *
 * Same cinematic background as the production Hero, but the SSO buttons are
 * swapped for the passwordless flow: POST an email to /api/v1/demo/session,
 * store the signed Bearer token, then enter the app. Each email gets its own
 * freshly-seeded workspace.
 */
interface DemoSessionResponse {
  token: string;
  email: string;
  orgId: string;
}

// Mirrors the production Hero background.
const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';
const LINKEDIN_URL = 'https://www.linkedin.com/in/tonywalteur/';

// The polo-preview Worker answers /__auth/*. Anywhere else (plain Vercel, local
// preview) the SPA fallback returns HTML, so only a JSON answer counts. A
// request that fails or times out is 'unknown', not 'none': on an OTP Worker
// the ungated flow would be rejected.
type Gate = { kind: 'signed-in'; email: string } | { kind: 'otp' } | { kind: 'none' } | { kind: 'unknown' };

const GATE_TIMEOUT_MS = 2500;

async function readGate(signal: AbortSignal): Promise<Gate> {
  try {
    const res = await fetch('/__auth/me', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return { kind: 'none' };
    const body = (await res.json()) as { email?: unknown; otp?: unknown };
    if (res.ok && typeof body.email === 'string' && body.email) return { kind: 'signed-in', email: body.email };
    if (res.status === 401 && body.otp === true) return { kind: 'otp' };
    return { kind: 'none' };
  } catch {
    return { kind: 'unknown' };
  }
}

async function discoverGate(): Promise<Gate> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), GATE_TIMEOUT_MS);
  try {
    return await readGate(ctrl.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

async function postAuth(path: string, body: Record<string, string>) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { retryAfterSeconds?: number };
  return { status: res.status, data };
}

type Step = 'checking' | 'email' | 'code' | 'entering';

export function DemoSignIn() {
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const reduceMotion = useReducedMotion();
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState(false);
  const [gateUnknown, setGateUnknown] = useState(false);
  const [step, setStep] = useState<Step>('checking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = useCallback(
    async (address: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await api<DemoSessionResponse>('/api/v1/demo/session', {
          method: 'POST',
          body: { email: address },
        });
        localStorage.setItem(DEMO_TOKEN_KEY, res.token);
        localStorage.setItem(DEMO_EMAIL_KEY, res.email);
        localStorage.setItem('bidstack:session', 'demo');
        localStorage.removeItem(DEMO_SIGNED_OUT_KEY);
        signIn(() => navigate('/dashboard', { replace: true }));
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : t(
                'demoSignIn.error.generic',
                'Could not start the demo. Please try again in a moment.',
              ),
        );
        setLoading(false);
        setStep('email');
      }
    },
    [navigate, signIn, t],
  );

  const enterRef = useRef(enter);
  useEffect(() => {
    enterRef.current = enter;
  }, [enter]);

  // Already verified by Cloudflare (Access session or a Polo code): no second
  // sign-in, unless the visitor just signed out on purpose.
  const applyGate = useCallback((gate: Gate) => {
    if (gate.kind === 'signed-in') {
      setEmail(gate.email);
      setGateUnknown(false);
      setOtp(false);
      if (localStorage.getItem(DEMO_SIGNED_OUT_KEY)) {
        setStep('email');
        return;
      }
      setStep('entering');
      void enterRef.current(gate.email);
      return;
    }
    setGateUnknown(gate.kind === 'unknown');
    setOtp(gate.kind === 'otp');
    setStep('email');
  }, []);

  useEffect(() => {
    let live = true;
    void discoverGate().then((gate) => {
      if (live) applyGate(gate);
    });
    return () => {
      live = false;
    };
  }, [applyGate]);

  function retryGate() {
    setError(null);
    setStep('checking');
    void discoverGate().then(applyGate);
  }

  async function requestCode() {
    const res = await postAuth('/__auth/code', { email: email.trim() });
    if (res.status === 202) {
      setCode('');
      setStep('code');
      return;
    }
    setError(
      res.status === 429
        ? t('demoSignIn.error.slowDown', 'Wait {{s}} s before asking for a new code.', {
            s: res.data.retryAfterSeconds ?? 60,
          })
        : res.status === 400
          ? t('demoSignIn.error.email', 'Enter a valid email.')
          : t('demoSignIn.error.send', 'Could not send the code. Try again in a moment.'),
    );
  }

  async function verifyCode() {
    const res = await postAuth('/__auth/verify', { email: email.trim(), code: code.trim() });
    if (res.status === 200) {
      setStep('entering');
      await enter(email.trim());
      return;
    }
    setError(t('demoSignIn.error.code', 'That code is wrong or expired.'));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || email.trim().length === 0) return;
    let useOtp = otp;
    if (gateUnknown) {
      setError(null);
      setLoading(true);
      const gate = await discoverGate();
      setLoading(false);
      if (gate.kind === 'unknown') {
        setError(t('demoSignIn.error.gate', 'Could not check sign-in. Check your connection and try again.'));
        return;
      }
      setGateUnknown(false);
      useOtp = gate.kind === 'otp';
      setOtp(useOtp);
    }
    if (!useOtp) {
      await enter(email.trim());
      return;
    }
    if (step === 'code' && code.trim().length === 0) return;
    setError(null);
    setLoading(true);
    try {
      await (step === 'code' ? verifyCode() : requestCode());
    } catch {
      setError(t('demoSignIn.error.send', 'Could not send the code. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  }

  const codeStep = otp && step === 'code';
  const busy = loading || step === 'entering';

  const fade = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[#f0f0f0]">
      <section className="relative flex h-full w-full flex-col overflow-hidden">
        {/* Cinematic background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 z-0 h-full w-full object-cover object-[65%] lg:object-center"
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>
        {/* Legibility scrim — keeps text/controls AA-contrast over any video frame */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.62),rgba(255,255,255,0.22)_58%,rgba(255,255,255,0.12))]"
        />

        <div className="relative z-10 flex h-full flex-col">
          {/* Header: real logo + author attribution */}
          <header className="flex items-center justify-between gap-4 px-6 py-5 md:px-10">
            <PoloPreSalesLogo
              variant="full"
              title={t('demoSignIn.logoAlt', 'Polo PreSales')}
              className="h-20 w-auto drop-shadow-sm sm:h-24 md:h-28"
            />
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-full bg-white/55 px-3.5 py-2 text-[13px] font-medium text-[rgba(30,50,90,0.85)] ring-1 ring-white/50 backdrop-blur-md transition hover:bg-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50"
            >
              <LinkedInIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t('demoSignIn.builtBy', 'Built by Tony Walteur')}
              </span>
              <span className="sm:hidden">{t('demoSignIn.authorName', 'Tony Walteur')}</span>
            </a>
          </header>

          {/* Centered hero + passwordless entry */}
          <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
            <motion.div
              {...fade}
              transition={{ duration: 0.5 }}
              className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/60 px-4 py-2 ring-1 ring-white/50 backdrop-blur-md"
            >
              <Sparkles className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span className="text-sm font-medium text-[rgba(30,50,90,0.9)]">
                {t('demoSignIn.badge', 'Live demo · no signup')}
              </span>
            </motion.div>

            <motion.h1
              {...fade}
              transition={{ duration: 0.6, delay: 0.05 }}
              className="mb-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-[#34405a] sm:text-5xl md:text-6xl"
            >
              {t('demoSignIn.heading', 'Explore Polo PreSales')}
            </motion.h1>

            <motion.p
              {...fade}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-8 max-w-xl text-base leading-relaxed text-[#4a5266] md:text-lg"
            >
              {t(
                'demoSignIn.subtitle',
                'Step inside a working pre-sales bid piloting workspace with real accounts, live pipeline, and an RFP response engine. Enter your email to open a private workspace.',
              )}
            </motion.p>

            <motion.form
              {...fade}
              transition={{ duration: 0.6, delay: 0.15 }}
              onSubmit={onSubmit}
              noValidate
              aria-busy={step === 'checking' || busy}
              className="w-full max-w-md rounded-2xl bg-white/75 p-2 shadow-[0_8px_40px_rgba(30,50,90,0.14)] ring-1 ring-white/60 backdrop-blur-xl sm:flex sm:items-center sm:gap-2"
            >
              {step === 'checking' || step === 'entering' ? (
                <p
                  role="status"
                  className="flex h-12 w-full items-center justify-center gap-2 px-4 text-[15px] text-slate-700"
                >
                  {step === 'entering'
                    ? t('demoSignIn.signingIn', 'Signing in as {{email}}…', { email })
                    : t('demoSignIn.checking', 'Checking your session…')}
                </p>
              ) : codeStep ? (
                <>
                  <label htmlFor="demo-code" className="sr-only">
                    {t('demoSignIn.codeLabel', 'Sign-in code sent to {{email}}', { email })}
                  </label>
                  <input
                    id="demo-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('demoSignIn.codePlaceholder', '6-digit code')}
                    disabled={busy}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'demo-error' : undefined}
                    className="h-12 w-full rounded-xl bg-transparent px-4 text-center font-mono text-[18px] tracking-[0.3em] text-slate-900 placeholder:font-sans placeholder:text-[15px] placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none disabled:opacity-60 sm:flex-1"
                  />
                  <button
                    type="submit"
                    disabled={busy || code.length !== 6}
                    className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0 sm:w-auto"
                  >
                    {busy ? t('demoSignIn.submitLoading', 'Setting up…') : t('demoSignIn.verify', 'Sign in')}
                    {busy ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </>
              ) : (
                <>
                  <label htmlFor="demo-email" className="sr-only">
                    {t('demoSignIn.emailLabel', 'Work email')}
                  </label>
                  <input
                    id="demo-email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('demoSignIn.emailPlaceholder', 'you@company.com')}
                    disabled={busy}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'demo-error' : undefined}
                    className="h-12 w-full rounded-xl bg-transparent px-4 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60 sm:flex-1"
                  />
                  <button
                    type="submit"
                    disabled={busy || email.trim().length === 0}
                    className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0 sm:w-auto"
                  >
                    {busy ? (
                      t('demoSignIn.submitLoading', 'Setting up…')
                    ) : (
                      <>
                        {otp ? t('demoSignIn.sendCode', 'Email me a code') : t('demoSignIn.submit', 'Enter the demo')}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </>
              )}
            </motion.form>

            {codeStep ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('email');
                }}
                className="mt-3 text-sm font-medium text-slate-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50"
              >
                {t('demoSignIn.changeEmail', 'Use a different email')}
              </button>
            ) : null}

            {error ? (
              <p id="demo-error" role="alert" className="mt-3 text-sm font-medium text-red-600">
                {error}
              </p>
            ) : gateUnknown && step === 'email' ? (
              <div role="status" className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-700">
                <span>{t('demoSignIn.gateUnknown', 'Could not check sign-in.')}</span>
                <button
                  type="button"
                  onClick={retryGate}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-slate-800 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50"
                >
                  {t('demoSignIn.retryGate', 'Retry')}
                </button>
              </div>
            ) : null}

            <motion.p
              {...fade}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-5 text-xs text-[#4a5266]/75"
            >
              {t(
                'demoSignIn.footnote',
                'Passwordless · your own isolated sandbox · resets periodically',
              )}
            </motion.p>
          </div>
        </div>
      </section>
    </div>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}
