import { Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronRight, Info } from 'lucide-react';

import { EmailSignIn, GoogleSignInButton, MicrosoftSignInButton } from '@/components/auth';

interface NavItem {
  label: string;
  hasDropdown?: boolean;
}

const navItems: NavItem[] = [];

import { useSignInAction } from '@/lib/auth';

export function Navbar() {
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const [showEmail, setShowEmail] = useState(false);

  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const microsoftEnabled = import.meta.env.VITE_SSO_MICROSOFT_ENABLED === 'true';
  const googleEnabled = import.meta.env.VITE_SSO_GOOGLE_ENABLED === 'true';
  const microsoftLabel = import.meta.env.VITE_SSO_MICROSOFT_LABEL ?? 'Sign in with Microsoft';
  const googleLabel = import.meta.env.VITE_SSO_GOOGLE_LABEL ?? 'Sign in with Google';
  const isStub = !clerkKey;

  return (
    <nav
      aria-label="Site navigation"
      className="flex items-center justify-between py-6 px-6 md:px-10 w-full relative z-10"
    >
      {/* Left Side (hidden spacer for centering, display creator) */}
      <div className="flex-1 hidden md:block">
        <span className="text-[12px] font-normal text-[rgba(30,50,90,0.75)]">Created by Tony</span>
      </div>

      {/* Center Menu */}
      <div className="hidden md:flex items-center gap-8 text-[rgb(45,45,45)] font-normal text-sm">
        {navItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="cursor-pointer hover:opacity-70 transition-opacity flex items-center gap-1 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(30,50,90,0.3)] rounded-sm bg-transparent border-none"
          >
            {item.label}
            {item.hasDropdown && (
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* Mobile Logo */}
      <div className="md:hidden flex flex-col items-start leading-none">
        <span className="font-regular tracking-tighter text-xl text-[rgba(30,50,90,0.9)]">
          BidStack
        </span>
        <span className="text-[9px] text-[rgba(30,50,90,0.5)] font-normal mt-0.5">
          Created by Tony
        </span>
      </div>

      {/* Right Side — Auth Buttons */}
      <div className="flex-1 flex justify-end items-center gap-2 md:gap-3">
        {isStub ? (
          <>
            <button
              type="button"
              onClick={() => signIn(() => navigate('/dashboard', { replace: true }))}
              aria-label="Sign in with Microsoft"
              className="flex items-center bg-[rgba(30,50,90,0.8)] text-white rounded-full px-3 md:px-5 py-1.5 md:py-2 gap-2 text-xs md:text-sm font-normal cursor-pointer hover:bg-[rgba(30,50,90,0.9)] active:scale-[0.98] transition-all"
            >
              <MicrosoftLogo />
              <span className="hidden sm:inline">{microsoftLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => signIn(() => navigate('/dashboard', { replace: true }))}
              aria-label="Sign in with Google"
              className="flex items-center bg-white text-[rgba(30,50,90,0.8)] rounded-full px-3 md:px-5 py-1.5 md:py-2 gap-2 text-xs md:text-sm font-normal border border-[rgba(30,50,90,0.1)] cursor-pointer hover:bg-gray-50 active:scale-[0.98] transition-all"
            >
              <GoogleLogo />
              <span className="hidden sm:inline">{googleLabel}</span>
            </button>
          </>
        ) : (
          <>
            {microsoftEnabled && <MicrosoftSignInButton label={microsoftLabel} variant="primary" />}
            {googleEnabled && <GoogleSignInButton label={googleLabel} variant="secondary" />}
          </>
        )}
      </div>

      {/* Email toggle (production only) */}
      {!isStub && (
        <button
          type="button"
          onClick={() => setShowEmail((v) => !v)}
          className="ml-3 text-[12px] font-normal underline underline-offset-4 text-[rgba(30,50,90,0.4)] hover:text-[rgba(30,50,90,0.7)] transition-colors cursor-pointer hidden md:block"
        >
          {showEmail ? 'Hide email' : 'Email'}
        </button>
      )}

      {/* Dev bypass (stub only) */}
      {isStub && (
        <motion.button
          type="button"
          onClick={() => signIn(() => navigate('/dashboard', { replace: true }))}
          aria-label="Dev bypass — enter dashboard without auth"
          className="ml-2 md:ml-3 flex items-center gap-1 text-[11px] font-normal text-amber-600/80 hover:text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 rounded-sm"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Info className="w-3 h-3" aria-hidden="true" />
          <span className="hidden sm:inline" aria-hidden="true">
            Dashboard
          </span>
        </motion.button>
      )}

      {/* Email form */}
      {showEmail && !isStub && (
        <div className="absolute top-full right-6 md:right-10 mt-2 w-72">
          <Suspense
            fallback={
              <div className="w-full rounded-xl bg-white/60 backdrop-blur-md border border-white/20 py-3 text-center text-xs text-[rgba(30,50,90,0.5)] font-normal animate-pulse">
                Loading form…
              </div>
            }
          >
            <EmailSignIn />
          </Suspense>
        </div>
      )}
    </nav>
  );
}

function MicrosoftLogo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 21 21"
      aria-hidden="true"
      className="md:w-[18px] md:h-[18px]"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="md:w-[18px] md:h-[18px]"
    >
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
  );
}
