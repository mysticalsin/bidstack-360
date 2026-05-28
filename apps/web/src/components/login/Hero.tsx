import { useReducedMotion } from 'framer-motion';
import { motion } from 'motion/react';

import { Navbar } from './Navbar';
import { HeroBadge } from './HeroBadge';
import { BottomLeftCard } from './BottomLeftCard';
import { BottomRightCorner } from './BottomRightCorner';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

export function Hero() {
  const reducedMotion = useReducedMotion();

  const h1Anim = reducedMotion
    ? {}
    : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 } };

  const pAnim = reducedMotion ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  return (
    <div className="w-full h-screen flex items-center justify-center bg-[#f0f0f0]">
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
          <div className="w-full flex flex-col items-center pt-8 px-6 text-center max-w-4xl">
            <HeroBadge />

            <motion.h1
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-normal text-[#5E6470] mb-2 tracking-tight leading-[1.05]"
              {...h1Anim}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              Win More Bids
            </motion.h1>

            <motion.p
              className="text-sm sm:text-base md:text-lg text-[#5E6470] opacity-80 leading-relaxed max-w-xl font-normal"
              {...pAnim}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              AI-powered RFP analysis, proposal generation, and compliance tracking — built for
              enterprise presales teams.
            </motion.p>
          </div>

          <BottomLeftCard />
          <BottomRightCorner />
        </div>
      </section>
    </div>
  );
}
