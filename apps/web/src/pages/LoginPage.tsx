import { Hero } from '@/components/login';
import { DemoSignIn } from '@/components/login/DemoSignIn';

/**
 * BidStack 360° glassmorphism login page.
 *
 * Full-screen video background with glassmorphism cards, minimal navbar,
 * and integrated Microsoft/Google SSO authentication.
 *
 * In the public demo deployment (VITE_AUTH_MODE=demo) we swap the SSO Hero for
 * the passwordless demo sign-in card — Microsoft/Google SSO isn't wired there.
 */
export function LoginPage() {
  const isDemo = import.meta.env.VITE_AUTH_MODE === 'demo';
  return (
    <main
      className="login-page relative z-[100] overflow-hidden"
      aria-label="Sign in"
      data-theme="light"
    >
      {isDemo ? <DemoSignIn /> : <Hero />}
    </main>
  );
}
