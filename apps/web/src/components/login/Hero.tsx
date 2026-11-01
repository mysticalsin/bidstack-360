import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { motion } from 'motion/react';

import { Navbar } from './Navbar';
import { HeroBadge } from './HeroBadge';
import { BottomLeftCard } from './BottomLeftCard';
import { BottomRightCorner } from './BottomRightCorner';

export function Hero() {
  const { t } = useTranslation('auth');
  const reducedMotion = useReducedMotion();

  const h1Anim = reducedMotion
    ? {}
    : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 } };

  const pAnim = reducedMotion ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <div className="w-full h-dvh flex items-center justify-center bg-[#f0f0f0]">
      <section className="relative w-full h-full overflow-hidden shadow-none flex flex-col items-center bg-[#f0f0f0]">
        {/* Content Layer */}
        <div className="relative z-10 w-full h-full flex flex-col items-center">
          <Navbar />

          {/* Text Container */}
          <div className="w-full flex-1 flex flex-col items-center justify-center -mt-24 px-6 text-center max-w-4xl">
            <HeroBadge />

            <motion.h1
              className="mb-3 text-4xl font-medium leading-tight text-[#2d323c] sm:text-5xl"
              {...h1Anim}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              {t('hero.title', 'Polo')}
            </motion.h1>

            <motion.p
              className="max-w-xl text-base leading-7 text-[#1e232e]"
              {...pAnim}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              {t(
                'hero.summary',
                'Presales, account, and proposal work in one place. Sign in with Microsoft. Google and Gmail stay available in this version.',
              )}
            </motion.p>
          </div>

          <BottomLeftCard />
          <BottomRightCorner />
        </div>
      </section>
    </div>
  );
}
