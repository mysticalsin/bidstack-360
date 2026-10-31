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
              className="mb-2 text-4xl font-medium leading-[1.05] text-[#2d323c] sm:text-5xl md:text-6xl lg:text-[80px]"
              {...h1Anim}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              {t('hero.winBids', 'Win More Bids')}
            </motion.h1>

            <motion.div
              className="mt-6 flex flex-col items-center bg-white/50 backdrop-blur-xl border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.1)] rounded-[2rem] px-6 py-5 sm:px-10 sm:py-6 max-w-2xl"
              {...pAnim}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <p className="text-sm sm:text-base md:text-lg text-[#1e232e] font-medium leading-relaxed mb-4">
                The complete operating system for enterprise presales. Manage RFPs, generate
                proposals, and track compliance in one workspace.
              </p>

              <div className="w-12 h-[2px] bg-[rgba(30,50,90,0.15)] mb-4 rounded-full" />

              <a
                href="https://www.linkedin.com/in/tonywalteur/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-xs font-medium text-[rgba(30,50,90,0.9)] transition-colors hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"
              >
                {t('hero.builtBy', 'Built by Tony Walteur')}
              </a>
            </motion.div>
          </div>

          <BottomLeftCard />
          <BottomRightCorner />
        </div>
      </section>
    </div>
  );
}
