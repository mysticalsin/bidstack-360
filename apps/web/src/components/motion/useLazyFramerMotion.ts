import { type ReactNode, useEffect, useState } from 'react';

interface MotionModule {
  MotionConfig: React.FC<{ reducedMotion: string; children: ReactNode }>;
  AnimatePresence: React.FC<{ mode?: string; initial?: boolean; children: ReactNode }>;
}

export function useLazyFramerMotion() {
  const [mod, setMod] = useState<MotionModule | null>(null);
  useEffect(() => {
    import('framer-motion').then((m) => {
      setMod(m as unknown as MotionModule);
    });
  }, []);
  return mod;
}
