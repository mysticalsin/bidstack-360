import '../styles/login.css';

import { Suspense, useCallback, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { motion } from 'motion/react';
import { ArrowUpRight, Menu, Play, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { BidStack360Logo } from '@/components/brand/BidStack360Logo';
import {
  AeonLogo,
  ApexLogo,
  OrbitLogo,
  VelaLogo,
  ZenoLogo,
} from '@/components/brand/partner-logos';
import { Starfield } from '@/components/canvas/Starfield';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/Dialog';
import { BlurText } from '@/components/motion/BlurText';
import {
  EmailSignIn,
  GoogleSignInButton,
  MicrosoftSignInButton,
} from '@/components/auth';

const PARTNERS = [
  { name: 'Aeon', Logo: AeonLogo },
  { name: 'Vela', Logo: VelaLogo },
  { name: 'Apex', Logo: ApexLogo },
  { name: 'Orbit', Logo: OrbitLogo },
  { name: 'Zeno', Logo: ZenoLogo },
];

const NAV_ITEMS = ['Home', 'Voyages', 'Worlds', 'Innovation', 'Plan Launch'];

const VIDEO_URL = import.meta.env.VITE_LOGIN_VIDEO_URL ?? '';
const YOUTUBE_EMBED = 'https://www.youtube.com/embed/21X5lGlDOfg?autoplay=1&rel=0';

export function LoginPage() {
  const reducedMotion = useReducedMotion();
  const [showEmail, setShowEmail] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const authRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const googleEnabled = import.meta.env.VITE_SSO_GOOGLE_ENABLED === 'true';
  const microsoftLabel = import.meta.env.VITE_SSO_MICROSOFT_LABEL ?? 'Sign in with Microsoft';
  const googleLabel = import.meta.env.VITE_SSO_GOOGLE_LABEL ?? 'Sign in with Google';
  const isStub = !clerkKey;

  const scrollToAuth = useCallback(() => {
    authRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    setMobileOpen(false);
  }, [reducedMotion]);

  const scrollToTop = useCallback(() => {
    topRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    setMobileOpen(false);
  }, [reducedMotion]);

  const handleNavClick = useCallback((label: string) => {
    if (label === 'Home') {
      scrollToTop();
    } else {
      scrollToAuth();
    }
  }, [scrollToTop, scrollToAuth]);

  return (
    <main
      ref={topRef}
      className="login-page fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#030508]"
      aria-label="Sign in"
    >
      {/* Background: Starfield (default) or Video (if configured) */}
      {VIDEO_URL ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/images/hero_bg.jpeg"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ zIndex: 0 }}
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>
      ) : (
        <Starfield />
      )}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 1,
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(3,5,8,0.4) 100%)',
        }}
      />

      {/* Content wrapper */}
      <div className="relative z-10 flex h-full flex-col">
        {/* sr-only h1 for accessibility */}
        <h1 className="sr-only">Sign in to BidStack 360°</h1>

        {/* Navbar */}
        <nav
          className="fixed left-0 right-0 top-4 z-50 flex items-center justify-between px-6 lg:px-16"
          aria-label="Primary navigation"
        >
          {/* Left: Logo */}
          <div className="flex items-center">
            <BidStack360Logo variant="full" className="h-10 md:h-12" tone="inverse" />
          </div>

          {/* Center: Nav pill (desktop only) */}
          <div className="hidden md:flex items-center">
            <div className="liquid-glass flex items-center gap-1 rounded-full px-1.5 py-1.5">
              {NAV_ITEMS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleNavClick(label)}
                  className="rounded-full px-3 py-2 text-sm font-medium text-white/90 font-body transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={scrollToAuth}
                className="inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-semibold font-body text-black transition-transform hover:scale-105 cursor-pointer"
              >
                Claim a Spot
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Right: Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="md:hidden liquid-glass inline-flex h-10 w-10 items-center justify-center rounded-full text-white cursor-pointer"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Desktop spacer for balance */}
          <div className="hidden md:block w-12" aria-hidden="true" />
        </nav>

        {/* Mobile nav overlay */}
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#030508]/95 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-6 top-6 inline-flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:text-white cursor-pointer"
              aria-label="Close menu"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="flex flex-col items-center gap-6">
              {NAV_ITEMS.map((label, i) => (
                <motion.button
                  key={label}
                  type="button"
                  onClick={() => handleNavClick(label)}
                  className="text-2xl font-light text-white/90 font-body hover:text-white cursor-pointer"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reducedMotion ? 0 : i * 0.05, duration: 0.25 }}
                >
                  {label}
                </motion.button>
              ))}
              <motion.button
                type="button"
                onClick={scrollToAuth}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold font-body text-black cursor-pointer"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reducedMotion ? 0 : NAV_ITEMS.length * 0.05, duration: 0.25 }}
              >
                Claim a Spot
                <ArrowUpRight className="h-4 w-4" />
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Hero Content */}
        <div className="flex flex-1 flex-col items-center justify-center px-4 pt-16 text-center">
          {/* Badge */}
          <div className="liquid-glass mb-6 inline-flex items-center gap-2 rounded-full px-1 py-1">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold font-body text-black">
              New
            </span>
            <span className="pr-3 text-sm text-white/90 font-body">
              Maiden Crewed Voyage to Mars Arrives 2026
            </span>
          </div>

          {/* Heading */}
          <BlurText
            text="Venture Past Our Sky Across the Universe"
            className="max-w-2xl justify-center text-5xl italic leading-[0.85] tracking-[-3px] text-white sm:text-6xl md:text-7xl lg:text-[5.5rem] font-heading"
            delay={100}
            animateBy="words"
            direction="bottom"
          />

          {/* Subheading */}
          <motion.p
            className="mt-3 max-w-xl text-sm font-light leading-relaxed text-white/80 md:text-base font-body"
            initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reducedMotion ? 0 : 0.8 }}
          >
            Discover the universe in ways once unimaginable. Our pioneering vessels and
            breakthrough engineering bring deep-space exploration within reach—secure and
            extraordinary.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            className="mt-6 flex flex-wrap items-center justify-center gap-4"
            initial={{ filter: 'blur(10px)', opacity: 0, y: 20 }}
            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reducedMotion ? 0 : 1.1 }}
          >
            <button
              type="button"
              onClick={scrollToAuth}
              className="liquid-glass-strong inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 cursor-pointer"
            >
              Start Your Voyage
              <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
            </button>

            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 cursor-pointer"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  View Liftoff
                </button>
              </DialogTrigger>
              <DialogContent title="Liftoff" className="border-white/10 bg-black/90 p-0">
                <div className="aspect-video w-full">
                  <iframe
                    src={YOUTUBE_EMBED}
                    title="SpaceX Falcon Heavy Liftoff"
                    className="h-full w-full rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </DialogContent>
            </Dialog>
          </motion.div>

          {/* Auth Section */}
          <motion.div
            ref={authRef}
            className="mt-6 flex w-full max-w-xs flex-col items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reducedMotion ? 0 : 1.4 }}
          >
            {isStub ? (
              <>
                <p className="text-xs font-light text-white/70 font-body">
                  Dev Mode — Authentication bypassed
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard', { replace: true })}
                  className="liquid-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 cursor-pointer"
                >
                  Skip to Dashboard
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-light text-white/70 font-body">
                  Sign in to continue
                </p>
                <div className="flex w-full flex-col gap-3">
                  {microsoftEnabled ? <MicrosoftSignInButton label={microsoftLabel} /> : null}
                  {googleEnabled ? <GoogleSignInButton label={googleLabel} /> : null}
                </div>

                <button
                  type="button"
                  onClick={() => setShowEmail((v) => !v)}
                  className="mt-2 rounded px-2 py-1 text-xs font-body text-white/60 underline underline-offset-2 transition-colors hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20 cursor-pointer"
                >
                  {showEmail ? 'Hide email sign-in' : 'Sign in with email'}
                </button>

                {showEmail && (
                  <Suspense
                    fallback={
                      <div className="w-full rounded-full bg-white/10 py-2.5 text-center text-sm text-white/60 font-body">
                        Loading sign-in form…
                      </div>
                    }
                  >
                    <EmailSignIn />
                  </Suspense>
                )}
              </>
            )}
          </motion.div>
        </div>

        {/* Partners Bar */}
        <div className="relative z-10 flex flex-col items-center gap-3 pb-5 md:pb-6">
          <div className="liquid-glass rounded-full px-3.5 py-1 text-xs font-medium text-white font-body">
            Collaborating with top aerospace pioneers globally
          </div>
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
            {PARTNERS.map(({ name, Logo }) => (
              <div key={name} className="flex flex-col items-center gap-1.5">
                <Logo className="h-8 w-8 text-white/70 md:h-10 md:w-10" />
                <span className="text-[10px] font-medium uppercase tracking-widest text-white/50 font-body">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
