import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Hero } from '@/components/login';
import { useAuth } from '@/lib/auth';

/**
 * Polo PreSales login page.
 *
 * Full-screen video background with glassmorphism cards and Microsoft/Google
 * sign-in. A session that already exists goes to the dashboard — the same
 * post-auth home the sign-in controls navigate to.
 */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main
      className="login-page relative z-[100] overflow-hidden"
      aria-label={t('login.pageAriaLabel', 'Sign in')}
      data-theme="light"
    >
      <Hero />
    </main>
  );
}
