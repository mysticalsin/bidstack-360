import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { motion } from 'motion/react';

import { Navbar } from './Navbar';
import { HeroBadge } from './HeroBadge';
import { BottomLeftCard } from './BottomLeftCard';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

export function Hero() {
  const { t } = useTranslation('auth');
  const reducedMotion = useReducedMotion();

  const h1Anim = reducedMotion
    ? {}
    : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 } };

  const pAnim = reducedMotion ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <div className="w-full h-dvh flex items-center justify-center bg-[#f0f0f0]">
      <section className="relative w-full h-full overflow-hidden shadow-none flex flex-col items-center bg-white/10 group">
        {/* Video Background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover object-[65%] lg:object-center z-0"
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>

        {/* Content Layer */}
        <div className="relative z-10 w-full h-full flex flex-col items-center">
          <Navbar />

          {/* Text Container */}
          <div className="w-full flex-1 flex flex-col items-center justify-center -mt-24 px-6 text-center max-w-4xl">
            <HeroBadge />

            <motion.h1
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-medium text-[#2d323c] drop-shadow-md mb-2 tracking-tight leading-[1.05]"
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
                className="text-xs sm:text-sm font-bold tracking-wider text-[rgba(30,50,90,0.9)] hover:text-black uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
              >
                {t('hero.builtBy', 'Built by Tony Walteur')}
              </a>
            </motion.div>
          </div>

          <BottomLeftCard />
        </div>
      </section>
    </div>
  );
}
