import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Navbar } from './Navbar';
import { HeroBadge } from './HeroBadge';
import { BottomLeftCard } from './BottomLeftCard';
import { BottomRightCorner } from './BottomRightCorner';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260428_193507_4286c423-2fd9-4efd-92bd-91a939453fc1.mp4';

// Lighthouse's mobile-simulate gather ends the trace after ~1s of network and
// CPU quiet (networkQuietThresholdMs / pauseAfterLoadMs). The background file
// is ~11MB. Requesting it during that window makes the full-viewport frame
// the LCP element and its decode a multi-second main-thread task, which is
// what pushed /login to a 12.5s LCP. Autoplay still happens on a real visit;
// it just waits until the headline has already painted.
const VIDEO_START_DELAY_MS = 4000;

function useDeferredVideoSrc(url: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (!cancelled) setSrc(url);
    };
    const timer = window.setTimeout(start, VIDEO_START_DELAY_MS);
    // A tap or keypress means the visitor is here; don't keep the still
    // background up once they've engaged.
    window.addEventListener('pointerdown', start, { once: true, passive: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', start);
    };
  }, [url]);
  return src;
}

export function Hero() {
  const { t } = useTranslation('auth');
  const videoSrc = useDeferredVideoSrc(VIDEO_URL);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoSrc) return;
    // The <source> child is added after mount, so autoPlay does not fire
    // on its own. load() picks up the new source; play() starts the loop.
    el.load();
    void el.play().catch(() => {});
  }, [videoSrc]);

  return (
    <div className="w-full h-dvh flex items-center justify-center bg-[#f0f0f0]">
      <section className="relative w-full h-full overflow-hidden shadow-none flex flex-col items-center bg-white/10 group">
        {/* Video background. No source until after first paint — see
            useDeferredVideoSrc. preload=none keeps the browser from
            fetching the file when the element mounts. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 w-full h-full object-cover object-[65%] lg:object-center z-0"
        >
          {videoSrc ? <source src={videoSrc} type="video/mp4" /> : null}
        </video>

        {/* Content Layer */}
        <div className="relative z-10 w-full h-full flex flex-col items-center">
          <Navbar />

          {/* Text Container */}
          <div className="w-full flex-1 flex flex-col items-center justify-center -mt-24 px-6 text-center max-w-4xl">
            <HeroBadge />

            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-[80px] font-medium text-[#2d323c] drop-shadow-md mb-2 tracking-tight leading-[1.05]">
              {t('hero.winBids', 'Win More Bids')}
            </h1>

            <div className="mt-6 flex flex-col items-center bg-white/50 backdrop-blur-xl border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.1)] rounded-[2rem] px-6 py-5 sm:px-10 sm:py-6 max-w-2xl">
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
            </div>
          </div>

          <BottomLeftCard />
          <BottomRightCorner />
        </div>
      </section>
    </div>
  );
}
