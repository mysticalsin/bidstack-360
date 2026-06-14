/**
 * bidRouteElements — bid/RFP/proposal/intake route definitions.
 *
 * WHY a function instead of a component: React Router v6's
 * createRoutesFromChildren traverses JSX statically. Calling a function that
 * returns a fragment lets the framework see the inner Route elements; wrapping
 * them in a component would hide them.
 */
import { Navigate, Route } from 'react-router-dom';

import { PageTransition } from '@/components/motion/PageTransition';
import {
  BidNoBidPage,
  IntakePage,
  ProposalDetailPage,
  ProposalsPage,
  ReferencesPage,
  RfpPipelinePage,
} from './lazyPages';
import { RequireAuth } from './AuthGuards';

export function bidRouteElements() {
  return (
    <>
      <Route
        path="/bid-matrix"
        element={
          <RequireAuth>
            <BidNoBidPage />
          </RequireAuth>
        }
      />
      {/* RFP Response Hub merged into Proposals (the work surface). The hub was
          a read-only roll-up; its rail door was removed and the route now
          redirects so existing links/bookmarks land on Proposals. */}
      <Route path="/rfp-response" element={<Navigate to="/proposals" replace />} />
      <Route
        path="/rfp/:id/pipeline"
        element={
          <RequireAuth>
            {/* Extra PageTransition because the RFP pipeline has its own
                animated layout separate from the top-level route transition. */}
            <PageTransition>
              <RfpPipelinePage />
            </PageTransition>
          </RequireAuth>
        }
      />
      <Route
        path="/proposals"
        element={
          <RequireAuth>
            <ProposalsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/proposals/:id"
        element={
          <RequireAuth>
            <ProposalDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/intake"
        element={
          <RequireAuth>
            <IntakePage />
          </RequireAuth>
        }
      />
      <Route
        path="/references"
        element={
          <RequireAuth>
            <ReferencesPage />
          </RequireAuth>
        }
      />
    </>
  );
}
