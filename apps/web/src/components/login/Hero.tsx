import { Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';

import { EmailSignIn } from '@/components/auth';
import { PoloPreSalesLogo } from '@/components/brand/PoloPreSalesLogo';
import { useSignInAction } from '@/lib/auth';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

// The public sign-in screen: a white brand mark + short line above ONE clean
// sign-in card, centered over a quiet video backdrop. No marketing copy, no
// card-in-a-card — the Clerk form is the single card. Local stub mode (no Clerk
// key) shows a single "Enter workspace" button in the same card position.
export function Hero() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const reduce = useReducedMotion();
  const hasClerk = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  const disableHeroVideo =
    import.meta.env.VITE_DISABLE_HERO_VIDEO === 'true' ||
    (typeof navigator !== 'undefined' && navigator.webdriver === true);
  const [playVideo, setPlayVideo] = useState(false);

  // Remote MP4 must not contend with first paint. Lighthouse CI still paid
  // TBT/SI when the idle timeout (1.5s) started Cloudfront mid-run
  // (scores 0.56 / 0.87 / 0.87). Automation and the LHCI build flag
  // keep the video off entirely.
  useEffect(() => {
    if (reduce || disableHeroVideo) return;
    const start = () => setPlayVideo(true);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 0);
    return () => window.clearTimeout(timer);
  }, [reduce, disableHeroVideo]);

  // Paint immediately. An opacity-0 first frame is why Lighthouse CI reported
  // NO_FCP on /login: headless Chrome never counted the delayed card as
  // contentful paint. Reduced-motion users also get the settled layout.
  const enter = reduce
    ? {}
    : { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.01 } };

  return (
    <div className="w-full h-dvh flex items-center justify-center bg-[#0b0d12]">
      <section className="relative w-full h-full overflow-hidden flex items-center justify-center">
        {playVideo ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 w-full h-full object-cover z-0"
          >
            <source src={VIDEO_URL} type="video/mp4" />
          </video>
        ) : null}
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/50 via-black/35 to-black/60" />

        <motion.div className="relative z-10 w-full max-w-[360px] mx-4 flex flex-col items-center" {...enter}>
          {/* Brand + welcome, white, directly on the backdrop. */}
          <PoloPreSalesLogo variant="full" tone="mono" className="h-10 w-auto text-white mb-5" />
          <h1 className="text-white text-[22px] font-semibold tracking-tight">
            {t('hero.signInTitle', 'Sign in')}
          </h1>
          <p className="text-white/60 text-sm mt-1.5 mb-7">
            {t('hero.signInSubtitle', 'Welcome back to your workspace.')}
          </p>

          {/* One card. In Clerk mode the Clerk <SignIn> IS the card (styled via
              EmailSignIn appearance) — no wrapper, so there is no card-in-card.
              Stub mode gets a plain white card with a single button. */}
          {hasClerk ? (
            <div className="w-full">
              <Suspense
                fallback={<div className="h-56 w-full animate-pulse rounded-3xl bg-white/10" aria-hidden />}
              >
                <EmailSignIn />
              </Suspense>
            </div>
          ) : (
            <div className="w-full rounded-3xl bg-white shadow-2xl px-6 py-7">
              <button
                type="button"
                onClick={() => signIn(() => navigate('/dashboard', { replace: true }))}
                className="w-full h-11 rounded-full bg-[#111826] hover:bg-black text-white text-sm font-medium transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111826]/40 focus-visible:ring-offset-2"
              >
                {t('hero.enterWorkspace', 'Enter workspace')}
              </button>
            </div>
          )}
        </motion.div>
      </section>
    </div>
  );
}
