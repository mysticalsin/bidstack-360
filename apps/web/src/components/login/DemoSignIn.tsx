import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, ApiError } from '@/lib/api';
import { DEMO_TOKEN_KEY, DEMO_EMAIL_KEY, useSignInAction } from '@/lib/auth';
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

export function DemoSignIn() {
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const reduceMotion = useReducedMotion();
  const { t } = useTranslation('auth');
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
          : t(
              'demoSignIn.error.generic',
              'Could not start the demo. Please try again in a moment.',
            ),
      );
      setLoading(false);
    }
  }

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
              className="h-10 w-auto drop-shadow-sm sm:h-12 md:h-14 lg:h-16"
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
              {t('demoSignIn.heading', 'Explore BidStack 360°')}
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
              className="w-full max-w-md rounded-2xl bg-white/75 p-2 shadow-[0_8px_40px_rgba(30,50,90,0.14)] ring-1 ring-white/60 backdrop-blur-xl sm:flex sm:items-center sm:gap-2"
            >
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
                disabled={loading}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'demo-error' : undefined}
                className="h-12 w-full rounded-xl bg-transparent px-4 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60 sm:flex-1"
              />
              <button
                type="submit"
                disabled={loading || email.trim().length === 0}
                className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]/50 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-0 sm:w-auto"
              >
                {loading ? (
                  t('demoSignIn.submitLoading', 'Setting up…')
                ) : (
                  <>
                    {t('demoSignIn.submit', 'Enter the demo')}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </motion.form>

            {error ? (
              <p id="demo-error" role="alert" className="mt-3 text-sm font-medium text-red-600">
                {error}
              </p>
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
