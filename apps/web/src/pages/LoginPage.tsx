import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Hero } from '@/components/login';
import { StubLoginBanner } from '@/components/identity/StubLoginBanner';
import { useRuntimeMode } from '@/lib/runtime-mode';

const CfAccessSignIn = lazy(() =>
  import('@/components/login/CfAccessSignIn').then((m) => ({ default: m.CfAccessSignIn })),
);
const DemoSignIn = lazy(() =>
  import('@/components/login/DemoSignIn').then((m) => ({ default: m.DemoSignIn })),
);

/**
 * Polo PreSales glassmorphism login page.
 *
 * Full-screen video background with glassmorphism cards, minimal navbar,
 * and integrated Microsoft/Google SSO authentication.
 *
 * The public demo door and Cloudflare Access come from GET /identity.
 */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const runtime = useRuntimeMode();
  const isDemo = runtime?.publicDemoDoor === true;
  const isCfAccess = runtime?.auth === 'cf-access';
  return (
    <main
      className="login-page relative z-[100] overflow-hidden"
      aria-label={t('login.pageAriaLabel', 'Sign in')}
      data-theme="light"
    >
      <StubLoginBanner />
      {isCfAccess ? (
        <Suspense fallback={null}>
          <CfAccessSignIn />
        </Suspense>
      ) : isDemo ? (
        <Suspense fallback={null}>
          <DemoSignIn />
        </Suspense>
      ) : (
        <Hero />
      )}
    </main>
  );
}
