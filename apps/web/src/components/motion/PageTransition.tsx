// The animated path lives in its own chunk. The dashboard's first paint uses a
// plain div so the entry does not wait on framer-motion to evaluate.

import { lazy, Suspense, type ReactNode } from 'react';

const MotionPageTransition = lazy(() =>
  import('./PageTransitionMotion').then((m) => ({ default: m.MotionPageTransition })),
);

interface Props {
  children: ReactNode;
  /** Stable key to drive AnimatePresence re-mounting (e.g. route path). */
  pageKey?: string;
  /**
   * Paint at full opacity on the first frame. The dashboard lead is the
   * Largest Contentful Paint element; an opacity-0 entrance kept it out of
   * the LCP candidate set until the lazy widget graph had already painted a
   * larger line.
   */
  visibleOnMount?: boolean;
}

export function PageTransition({ children, pageKey, visibleOnMount = false }: Props) {
  if (visibleOnMount) {
    return <div key={pageKey}>{children}</div>;
  }
  return (
    <Suspense fallback={<div key={pageKey}>{children}</div>}>
      <MotionPageTransition pageKey={pageKey}>{children}</MotionPageTransition>
    </Suspense>
  );
}
