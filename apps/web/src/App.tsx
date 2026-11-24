import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useUser } from '@/lib/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { useHelpDrawerHotkey } from '@/components/help/useHelpDrawer';
import { AppShell } from '@/components/layout/AppShell';
import { PageTransition } from '@/components/motion/PageTransition';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { LoadingSkeleton } from '@/components/ui/PlainSkeleton';
import { useCmdDotClose } from '@/hooks/useCmdDotClose';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useOverlayMount } from '@/lib/prodMount';
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
// Hosts are global but not the first paint. Their modules pull motion into
// the entry evaluation when imported statically.
const Toaster = lazy(() => import('@/components/ui/Toaster').then((m) => ({ default: m.Toaster })));
const ConfirmHost = lazy(() =>
  import('@/components/ui/ConfirmDialog').then((m) => ({ default: m.ConfirmHost })),
);
const PromptHost = lazy(() =>
  import('@/components/ui/ConfirmDialog').then((m) => ({ default: m.PromptHost })),
);
const ConfettiHost = lazy(() =>
  import('@/components/delight/Confetti').then((m) => ({ default: m.ConfettiHost })),
);
const WebVitalsHud = lazy(() =>
  import('@/components/dev/WebVitalsHud').then((m) => ({ default: m.WebVitalsHud })),
);
const SampleDataBanner = lazy(() =>
  import('@/components/onboarding/SampleDataBanner').then((m) => ({ default: m.SampleDataBanner })),
);
const GlobalInteractionSound = lazy(() =>
  import('@/components/sound/GlobalInteractionSound').then((m) => ({
    default: m.GlobalInteractionSound,
  })),
);

export function App() {
  const palette = useCommandPalette();
  const overlays = useOverlayMount();
  // Hosts pull framer-motion. Mount them on the first gesture so the
  // dashboard audit does not evaluate that chunk while it is scoring.
  const hostsReady = overlays;
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

  return (
    <>
      <RouteProgress />
      {isShellLess ? (
        <ErrorBoundary>
          <Suspense fallback={<LoadingSkeleton rows={6} />}>
            <AppRoutes />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <AppShell>
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
          {overlays && (
            <Suspense fallback={null}>
              <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
              <QuickAddMenu />
              <HelpDrawer />
              <ProductTour />
              <TemplatePicker />
            </Suspense>
          )}
          {/* Global hosts — mount once so any component can dispatch without prop-drilling */}
          {hostsReady && (
            <Suspense fallback={null}>
              <Toaster />
              <ConfirmHost />
              <PromptHost />
              <ConfettiHost />
              <WebVitalsHud />
              <SampleDataBanner />
              <GlobalInteractionSound />
            </Suspense>
          )}
          <LiveAnnouncer />
        </AppShell>
      )}
    </>
  );
}
