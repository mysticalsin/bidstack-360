import { useRef, useEffect, useState } from 'react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260221_085953_8463b46e-ba85-4bb7-912a-1feaf346e970.mp4';

function getInitialReduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-screen video background with seamless loop fade transitions.
 *
 * Fade logic:
 * - Fade out to black starting 1.5s before video end, reaching opacity 0
 *   by 0.3s before the end.
 * - Fade back in over the first 1.0s when the video restarts.
 * - Uses requestAnimationFrame for smooth opacity updates.
 *
 * Respects prefers-reduced-motion: video is hidden, static dark bg shown.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const [reduceMotion, setReduceMotion] = useState(getInitialReduceMotion);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const video = videoRef.current;
    const wrapper = wrapperRef.current;
    if (!video || !wrapper) return;

    const tick = () => {
      if (video.duration === Infinity || Number.isNaN(video.duration)) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const { currentTime, duration } = video;
      let opacity = 1;

      // Fade out: last 1.5s, reaching 0 by 0.3s before end
      if (currentTime > duration - 1.5) {
        opacity = Math.max(0, (duration - 0.3 - currentTime) / 1.2);
      }
      // Fade in: first 1.0s after restart
      else if (currentTime < 1.0) {
        opacity = Math.min(1, currentTime / 1.0);
      }

      wrapper.style.opacity = String(opacity);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduceMotion]);

  if (reduceMotion) {
    return <div className="absolute inset-0 z-0 bg-[hsl(240,67%,1%)]" aria-hidden="true" />;
  }

  return (
    <div ref={wrapperRef} className="absolute inset-0 z-0" aria-hidden="true">
      <video
        ref={videoRef}
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
