import { Hero } from '@/components/login';

/**
 * BidStack 360° glassmorphism login page.
 *
 * Full-screen video background with glassmorphism cards, minimal navbar,
 * and integrated Microsoft/Google SSO authentication.
 */
export function LoginPage() {
  return (
    <main className="login-page relative z-[100] overflow-hidden" aria-label="Sign in">
      <Hero />
    </main>
  );
}
