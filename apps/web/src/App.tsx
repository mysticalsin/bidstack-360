import { MotionConfig } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useUser } from '@/lib/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { ConfettiHost } from '@/components/delight/Confetti';
import { WebVitalsHud } from '@/components/dev/WebVitalsHud';
import { useHelpDrawerHotkey } from '@/components/help/useHelpDrawer';
import { AppShell } from '@/components/layout/AppShell';
import { PageTransition } from '@/components/motion/PageTransition';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { SampleDataBanner } from '@/components/onboarding/SampleDataBanner';
import { GlobalInteractionSound } from '@/components/sound/GlobalInteractionSound';
import { ConfirmHost, PromptHost } from '@/components/ui/ConfirmDialog';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Toaster } from '@/components/ui/Toast';
import { useCmdDotClose } from '@/hooks/useCmdDotClose';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { usePreferences } from '@/stores/preferences';
import { useCockpitLayout } from '@/stores/cockpitLayout';
import { useOnboardingStore } from '@/stores/onboarding';
import { useGlobalUndoHotkey } from '@/stores/undoStack';
import { AppRoutes } from '@/routes/AppRoutes';

// These overlays are not the first paint. Loading them as their own chunks
// keeps the entry under the 200KB app-chunk budget. The hotkey stores stay
// eager, so a shortcut pressed before the chunk arrives still opens the
// overlay once it mounts.
const CommandPalette = lazy(() =>
  import('@/components/command/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const HelpDrawer = lazy(() =>
  import('@/components/help/HelpDrawer').then((m) => ({ default: m.HelpDrawer })),
);
const ProductTour = lazy(() =>
  import('@/components/onboarding/ProductTour').then((m) => ({ default: m.ProductTour })),
);
const TemplatePicker = lazy(() =>
  import('@/components/onboarding/TemplatePicker').then((m) => ({ default: m.TemplatePicker })),
);
const QuickAddMenu = lazy(() =>
  import('@/components/quickadd/QuickAddMenu').then((m) => ({ default: m.QuickAddMenu })),
);

export function App() {
  const palette = useCommandPalette();
  useHelpDrawerHotkey();
  useCmdDotClose();
  useGlobalShortcuts();
  useGlobalUndoHotkey();
  const location = useLocation();
  const isShellLess = location.pathname === '/login' || location.pathname.startsWith('/sign/');

  const { user } = useUser();
  const scopePreferences = usePreferences((s) => s.scopeToUser);
  const scopeCockpitLayout = useCockpitLayout((s) => s.scopeToUser);
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrate);

  useEffect(() => {
    const userId = user?.id ?? null;
    scopePreferences(userId);
    scopeCockpitLayout(userId);
    // Onboarding state is keyed by user and may auto-start the product tour,
    // so it must only hydrate once a user is authenticated — never on the
    // login screen with a null user.
    if (userId) hydrateOnboarding(userId);
  }, [user?.id, scopePreferences, scopeCockpitLayout, hydrateOnboarding]);

  // Map our 3-way motion pref onto framer-motion's MotionConfig contract.
  // `system` → framer's `user` (read prefers-reduced-motion).
  // `reduced` → force `always`. `full` → force `never`.
  const motion = usePreferences((s) => s.motion);
  const reducedMotion = motion === 'reduced' ? 'always' : motion === 'full' ? 'never' : 'user';

  return (
    <MotionConfig reducedMotion={reducedMotion}>
      <RouteProgress />
      {isShellLess ? (
        <ErrorBoundary>
          <Suspense fallback={<LoadingSkeleton rows={6} />}>
            <AppRoutes />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <AppShell>
          <GlobalInteractionSound />
          {/* ErrorBoundary scoped inside AppShell so a render error in any page
              falls back gracefully while the sidebar/topbar survive. */}
          {/* Enter-only page transition keyed on the path: each navigation
              fades+rises the new page in. No exit animation (avoids router
              location-freezing complexity); reduced-motion → opacity only. */}
          <PageTransition
            pageKey={location.pathname}
            visibleOnMount={location.pathname === '/dashboard'}
          >
            <ErrorBoundary>
              <Suspense fallback={<LoadingSkeleton rows={6} />}>
                <AppRoutes />
              </Suspense>
            </ErrorBoundary>
          </PageTransition>
          <Suspense fallback={null}>
            <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
            <QuickAddMenu />
            <HelpDrawer />
            <ProductTour />
            <TemplatePicker />
          </Suspense>
          {/* Global hosts — mount once so any component can dispatch without prop-drilling */}
          <Toaster />
          <ConfirmHost />
          <PromptHost />
          <ConfettiHost />
          <LiveAnnouncer />
          <WebVitalsHud />
          <SampleDataBanner />
        </AppShell>
      )}
    </MotionConfig>
  );
}
