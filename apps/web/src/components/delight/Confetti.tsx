// Tiny, dependency-free confetti burst. Fires when `useConfetti.fire()` is
// called from anywhere — the celebration when a deal flips to closed_won.
// Particles are absolutely positioned divs animated with framer-motion;
// no canvas, no extra runtime — adds <2 KB to the bundle.
//
// We cap particles at 60 and clean them up after the longest animation
// duration so memory doesn't bloat from repeated triggers.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useState } from 'react';

import { useConfetti } from './useConfetti';

const COLORS = ['#2c4bff', '#1f8a5b', '#f5b400', '#ec4899', '#8b5cf6', '#06b6d4'];
const PARTICLE_COUNT = 60;

export function ConfettiHost() {
  const bursts = useConfetti((s) => s.bursts);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[300] overflow-hidden">
      <AnimatePresence>
        {bursts.map((id) => (
          <Burst key={id} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface Particle {
  color: string;
  dx: number;
  dy: number;
  rotation: number;
  size: number;
  duration: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
    const color = COLORS[i % COLORS.length] ?? '#2c4bff';
    // Random launch angle, weighted upward — gravity-style arc.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
    const speed = 220 + Math.random() * 240;
    return {
      color,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed - Math.random() * 100,
      rotation: (Math.random() - 0.5) * 720,
      size: 8 + Math.random() * 6,
      duration: 1.2 + Math.random(),
    };
  });
}

function Burst() {
  const id = useId();
  const reduced = useReducedMotion();
  // Sample the randomized particle field once at mount via lazy init so
  // Math.random doesn't run during render (which is an impurity the
  // react-hooks lint rule flags). The same shape persists for the burst's
  // lifetime — exactly what we want.
  const [particles] = useState<Particle[]>(() => makeParticles());
  // Reduced-motion users get a quick brand pulse instead of flying
  // confetti — same "yay something happened" signal, no motion.
  if (reduced) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.18, 0] }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 bg-[var(--brand-primary)]"
      />
    );
  }
  return (
    <>
      {particles.map((p, i) => (
        <motion.span
          key={`${id}-${i}`}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: p.dx,
            // Add a +400 floor so particles fall past their launch height
            // — the gravity feel.
            y: p.dy + 400,
            rotate: p.rotation,
            opacity: 0,
          }}
          transition={{ duration: p.duration, ease: [0.2, 0.7, 0.4, 1] }}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: p.size,
            height: p.size * 0.35,
            backgroundColor: p.color,
            borderRadius: 2,
          }}
        />
      ))}
    </>
  );
}
