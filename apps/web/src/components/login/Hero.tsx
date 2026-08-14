import { Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';

import { EmailSignIn } from '@/components/auth';
import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { useSignInAction } from '@/lib/auth';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

// The public sign-in screen. A single clean login card centered over a quiet
// video backdrop — no marketing copy, one obvious action. In real (Clerk) mode
// the card holds the email + password form; in local stub mode (no Clerk key)
// it collapses to a single "Enter workspace" button so dev sign-in still works.
export function Hero() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const reduce = useReducedMotion();
  const hasClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

  const card = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };

  return (
    <div className="w-full h-dvh flex items-center justify-center bg-[#0b0d12]">
      <section className="relative w-full h-full overflow-hidden flex items-center justify-center">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover z-0"
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>
        {/* Legibility scrim over the video. */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/45 via-black/30 to-black/55" />

        <motion.div className="relative z-10 w-full max-w-[380px] mx-4" {...card}>
          {/* One unified white card: logo + heading + the Clerk form, whose own
              card chrome is flattened (see EmailSignIn appearance) so it reads
              as a single surface instead of a card-in-a-card. */}
          <div className="rounded-[28px] bg-white shadow-[0_24px_70px_rgba(0,0,0,0.4)] px-7 pt-9 pb-7 sm:px-9 sm:pt-10">
            <div className="flex flex-col items-center text-center mb-6">
              <PoloPreSalesLogo variant="full" className="h-11 w-auto mb-5" />
              <h1 className="text-[#111826] text-[22px] font-semibold tracking-tight">
                {t('hero.signInTitle', 'Sign in')}
              </h1>
              <p className="text-[#5b6472] text-sm mt-1.5">
                {t('hero.signInSubtitle', 'Welcome back to your workspace.')}
              </p>
            </div>

            {hasClerk ? (
              <Suspense
                fallback={<div className="h-44 animate-pulse rounded-2xl bg-black/5" aria-hidden />}
              >
                <EmailSignIn />
              </Suspense>
            ) : (
              <button
                type="button"
                onClick={() => signIn(() => navigate('/dashboard', { replace: true }))}
                className="w-full h-11 rounded-full bg-[#111826] hover:bg-black text-white text-sm font-medium transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111826]/40 focus-visible:ring-offset-2"
              >
                {t('hero.enterWorkspace', 'Enter workspace')}
              </button>
            )}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
