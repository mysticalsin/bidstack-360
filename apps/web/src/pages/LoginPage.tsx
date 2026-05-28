import '../styles/login.css';

import { VideoBackground, TransparentNavbar, HeroContent } from '@/components/login';

/**
 * Weblex Dark Hero login page.
 *
 * Full-screen video background with seamless loop fade, minimal navbar,
 * and centered hero content containing SSO login buttons.
 *
 * Uses dvh for proper full-screen on mobile browsers (iOS Safari).
 * Content scrolls if the viewport is too short.
 * Auth logic (Microsoft SSO, Google SSO, stub bypass, email toggle) is
 * preserved inside HeroContent.
 */
export function LoginPage() {
  return (
    <main
      className="login-page relative z-[100] overflow-hidden h-dvh w-full"
      style={{ backgroundColor: 'hsl(240, 67%, 1%)' }}
      aria-label="Sign in"
    >
      {/* Full-screen video background */}
      <VideoBackground />

      {/* Minimal top navbar — logo only */}
      <TransparentNavbar />

      {/* Hero content — centered, scrollable if needed */}
      <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto">
        <div className="w-full min-h-dvh flex flex-col justify-center sm:justify-end px-4 py-[80px] sm:pb-[100px]">
          <HeroContent />
        </div>
      </div>
    </main>
  );
}
