import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

import { NavBar } from './components/NavBar';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';

// Lazy-load secondary routes so the landing page (the primary conversion
// surface) ships with the smallest possible JS budget. Each chunk is < 20 KB.
const PricingPage = lazy(() => import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })));
const TermsPage = lazy(() => import('./pages/legal/TermsPage').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() =>
  import('./pages/legal/PrivacyPage').then((m) => ({ default: m.PrivacyPage })),
);
const DPAPage = lazy(() => import('./pages/legal/DPAPage').then((m) => ({ default: m.DPAPage })));
const SecurityPage = lazy(() =>
  import('./pages/legal/SecurityPage').then((m) => ({ default: m.SecurityPage })),
);

// Smooth-scroll to top on route change so legal-page deep links don't open
// halfway down. Respects users navigating with hash anchors (#why, #ai).
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return; // let anchor links scroll naturally
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <ScrollToTop />
      <NavBar />
      <main id="main" className="flex-1">
        <Suspense
          fallback={
            <div className="mkt-container py-24 text-center text-[color:var(--fg-tertiary)]">
              Loading…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/legal/terms" element={<TermsPage />} />
            <Route path="/legal/privacy" element={<PrivacyPage />} />
            <Route path="/legal/dpa" element={<DPAPage />} />
            <Route path="/legal/security" element={<SecurityPage />} />
            {/* Unknown route — show landing page rather than a blank 404 so the
                site stays useful even with link rot. Marketing-grade fallback. */}
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
