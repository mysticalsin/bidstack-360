import { useTranslation } from 'react-i18next';
import { Hero } from '@/components/login';
import { CfAccessSignIn } from '@/components/login/CfAccessSignIn';
import { DemoSignIn } from '@/components/login/DemoSignIn';

/**
 * Polo PreSales glassmorphism login page.
 *
 * Full-screen video background with glassmorphism cards, minimal navbar,
 * and integrated Microsoft/Google SSO authentication.
 *
 * In the public demo deployment (VITE_AUTH_MODE=demo) we swap the SSO Hero for
 * the passwordless demo sign-in card — Microsoft/Google SSO isn't wired there.
 */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const isDemo = import.meta.env.VITE_AUTH_MODE === 'demo';
  const isCfAccess = import.meta.env.VITE_AUTH_MODE === 'cf-access';
  return (
    <main
      className="login-page relative z-[100] overflow-hidden"
      aria-label={t('login.pageAriaLabel', 'Sign in')}
      data-theme="light"
    >
      {isCfAccess ? <CfAccessSignIn /> : isDemo ? <DemoSignIn /> : <Hero />}
    </main>
  );
}
