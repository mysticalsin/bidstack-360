import { MotionConfig } from 'framer-motion';
import { Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { useUser } from '@/lib/auth';
import { CommandPalette } from '@/components/command/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { ConfettiHost } from '@/components/delight/Confetti';
import { WebVitalsHud } from '@/components/dev/WebVitalsHud';
import { HelpDrawer } from '@/components/help/HelpDrawer';
import { useHelpDrawerHotkey } from '@/components/help/useHelpDrawer';
import { AppShell } from '@/components/layout/AppShell';
import { PageTransition } from '@/components/motion/PageTransition';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { SampleDataBanner } from '@/components/onboarding/SampleDataBanner';
import { TemplatePicker } from '@/components/onboarding/TemplatePicker';
import { QuickAddMenu } from '@/components/quickadd/QuickAddMenu';
import { GlobalInteractionSound } from '@/components/sound/GlobalInteractionSound';
import { ConfirmHost, PromptHost } from '@/components/ui/ConfirmDialog';
import { LoadingSkeleton } from '@/components/ui/StateMessages';
import { Toaster } from '@/components/ui/Toast';
import { useCmdDotClose } from '@/hooks/useCmdDotClose';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { usePreferences } from '@/stores/preferences';
import { useCockpitLayout } from '@/stores/cockpitLayout';
import { useGlobalUndoHotkey } from '@/stores/undoStack';
import { AppRoutes } from '@/routes/AppRoutes';

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

  useEffect(() => {
    const userId = user?.id ?? null;
    scopePreferences(userId);
    scopeCockpitLayout(userId);
  }, [user?.id, scopePreferences, scopeCockpitLayout]);

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
          <PageTransition pageKey={location.pathname}>
            <ErrorBoundary>
              <Suspense fallback={<LoadingSkeleton rows={6} />}>
                <AppRoutes />
              </Suspense>
            </ErrorBoundary>
          </PageTransition>
          <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
          <QuickAddMenu />
          <HelpDrawer />
          {/* Global hosts — mount once so any component can dispatch without prop-drilling */}
          <Toaster />
          <ConfirmHost />
          <PromptHost />
          <ConfettiHost />
          <LiveAnnouncer />
          <WebVitalsHud />
          {/* Onboarding overlays */}
          <ProductTour />
          <SampleDataBanner />
          <TemplatePicker />
        </AppShell>
      )}
    </MotionConfig>
  );
}
