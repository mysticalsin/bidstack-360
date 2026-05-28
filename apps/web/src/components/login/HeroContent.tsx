import { Suspense, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { motion } from 'motion/react';
import { ArrowUpRight, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { EmailSignIn, GoogleSignInButton, MicrosoftSignInButton } from '@/components/auth';

/**
 * Bottom-aligned hero content adapted for login.
 *
 * Badge → Heading → Paragraph → SSO buttons (side by side on desktop,
 * stacked on mobile). Dev bypass and email toggle preserved.
 */
export function HeroContent() {
  const reducedMotion = useReducedMotion();
  const [showEmail, setShowEmail] = useState(false);
  const navigate = useNavigate();

  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const googleEnabled = import.meta.env.VITE_SSO_GOOGLE_ENABLED === 'true';
  const microsoftLabel = import.meta.env.VITE_SSO_MICROSOFT_LABEL ?? 'Sign in with Microsoft';
  const googleLabel = import.meta.env.VITE_SSO_GOOGLE_LABEL ?? 'Sign in with Google';
  const isStub = !clerkKey;

  const anim = reducedMotion
    ? {}
    : { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col items-center text-center w-full max-w-[603px] mx-auto px-6">
      {/* Badge */}
      <motion.div
        className="mb-6 inline-flex items-center rounded-full border px-4 py-1.5 text-xs font-body font-medium backdrop-blur-sm"
        style={{
          borderColor: 'hsla(0, 0%, 100%, 0.15)',
          color: 'hsla(0, 0%, 90%, 0.9)',
          backgroundColor: 'hsla(240, 10%, 12%, 0.4)',
        }}
        {...anim}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        Secure Enterprise Login
      </motion.div>

      {/* Heading */}
      <motion.h1
        className="text-[36px] font-body font-medium text-white leading-[1.1] tracking-[-0.02em] md:text-[48px] lg:text-[62px]"
        {...anim}
        transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      >
        Welcome back to BidStack 360°
      </motion.h1>

      {/* Paragraph */}
      <motion.p
        className="mt-5 text-base font-body font-light leading-relaxed max-w-[520px] mx-auto"
        style={{ color: 'hsla(0, 0%, 82%, 0.8)' }}
        {...anim}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        Sign in with your organization&apos;s SSO to access your pipeline, proposals, and bid
        intelligence.
      </motion.p>

      {/* SSO Buttons */}
      <motion.div
        className="mt-10 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center"
        {...anim}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Microsoft — Primary (lime) */}
        {microsoftEnabled && !isStub && (
          <MicrosoftSignInButton label={microsoftLabel} variant="primary" />
        )}
        {/* Google — Secondary (white) */}
        {googleEnabled && !isStub && <GoogleSignInButton label={googleLabel} variant="secondary" />}

        {/* Dev preview — disabled buttons */}
        {isStub && (
          <>
            <button
              type="button"
              disabled
              className="sso-btn-primary"
              title="Requires VITE_CLERK_PUBLISHABLE_KEY"
            >
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              {microsoftLabel}
            </button>
            <button
              type="button"
              disabled
              className="sso-btn-secondary"
              title="Requires VITE_CLERK_PUBLISHABLE_KEY"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {googleLabel}
            </button>
          </>
        )}
      </motion.div>

      {/* Email sign-in toggle (production only) */}
      {!isStub && (
        <motion.div className="mt-5" {...anim} transition={{ duration: 0.5, delay: 0.2 }}>
          <button
            type="button"
            onClick={() => setShowEmail((v) => !v)}
            className="text-[12px] font-body font-light underline underline-offset-4 text-white/30 hover:text-white/60 transition-colors cursor-pointer"
          >
            {showEmail ? 'Hide email sign-in' : 'Sign in with email'}
          </button>
        </motion.div>
      )}

      {showEmail && !isStub && (
        <motion.div
          className="mt-4 w-full max-w-sm mx-auto"
          initial={reducedMotion ? {} : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Suspense
            fallback={
              <div className="w-full rounded-xl bg-white/[0.03] border border-white/[0.06] py-3 text-center text-xs text-white/40 font-body animate-pulse">
                Loading form…
              </div>
            }
          >
            <EmailSignIn />
          </Suspense>
        </motion.div>
      )}

      {/* Dev bypass card */}
      {isStub && (
        <motion.div
          className="mt-6 w-full max-w-sm mx-auto space-y-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]"
          initial={reducedMotion ? {} : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <div className="flex items-center gap-2 text-[11px] font-medium text-amber-400/70 font-body">
            <Info className="h-3.5 w-3.5" />
            Dev mode — Clerk not configured
          </div>
          <button
            type="button"
            onClick={() => navigate('/dashboard', { replace: true })}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.12] active:scale-[0.98] transition-all cursor-pointer"
          >
            Enter Dashboard
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}

      {/* Attribution */}
      <motion.p
        className="mt-8 text-[11px] font-body font-light text-white/20"
        initial={reducedMotion ? {} : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
      >
        Made by Tony Walteur
      </motion.p>
    </div>
  );
}
