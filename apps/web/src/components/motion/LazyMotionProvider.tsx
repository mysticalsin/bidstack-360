import { type ReactNode } from 'react';

import { useLazyFramerMotion } from './useLazyFramerMotion';

export function LazyMotionConfig({
  reducedMotion,
  children,
}: {
  reducedMotion: string;
  children: ReactNode;
}) {
  const fm = useLazyFramerMotion();
  if (!fm) return <>{children}</>;
  return <fm.MotionConfig reducedMotion={reducedMotion}>{children}</fm.MotionConfig>;
}

export function LazyAnimatePresence({ children }: { children: ReactNode }) {
  const fm = useLazyFramerMotion();
  if (!fm) return <>{children}</>;
  return (
    <fm.AnimatePresence mode="wait" initial={false}>
      {children}
    </fm.AnimatePresence>
  );
}
