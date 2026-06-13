/**
 * bidRouteElements — bid/RFP/proposal/intake route definitions.
 *
 * WHY a function instead of a component: React Router v6's
 * createRoutesFromChildren traverses JSX statically. Calling a function that
 * returns a fragment lets the framework see the inner Route elements; wrapping
 * them in a component would hide them.
 */
import { Route } from 'react-router-dom';

import { PageTransition } from '@/components/motion/PageTransition';
import {
  BidNoBidPage,
  IntakePage,
  ProposalDetailPage,
  ProposalsPage,
  ReferencesPage,
  RfpPipelinePage,
  RfpResponseHubPage,
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
      <Route
        path="/rfp-response"
        element={
          <RequireAuth>
            <RfpResponseHubPage />
          </RequireAuth>
        }
      />
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
