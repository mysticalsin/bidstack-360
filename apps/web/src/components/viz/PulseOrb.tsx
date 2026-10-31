// Living "pulse" for watchdog / account health, built on thinking-orbs
// (MIT, Jakub Antalik, https://orbs.jakubantalik.com; see THIRD_PARTY_NOTICES.md).
// Decorative: the text beside it always carries the meaning, so the orb is
// hidden from assistive tech. Under reduced motion it renders one still frame.
import { useReducedMotion } from 'motion/react';
import { ThinkingOrb, type OrbSize, type OrbState } from 'thinking-orbs';

export type PulseTone = 'calm' | 'watch' | 'alert' | 'thinking';

// Light-theme Polo hexes (--brand-primary, --warning, --danger); the orb
// lifts its tint itself on dark substrates.
const TONE: Record<PulseTone, { state: OrbState; color: string; speed: number }> = {
  calm: { state: 'breathing', color: '#006b4f', speed: 0.8 },
  watch: { state: 'searching', color: '#8a5a00', speed: 0.9 },
  alert: { state: 'working', color: '#b82032', speed: 1 },
  thinking: { state: 'composing', color: '#006b4f', speed: 1 },
};

/** Nearest tuned preset at or above the requested display size. */
function presetFor(px: number): OrbSize {
  return px > 32 ? 64 : px > 20 ? 32 : 20;
}

/**
 * `size` is the on-screen size in CSS px (any value). The library only tunes
 * 20/32/64, so we draw the nearest preset at or above it and scale it into
 * the box. `bold` thickens the dots and adds a soft tinted halo for contrast
 * on light surfaces.
 */
export function PulseOrb({ tone, size = 32, bold = false, className }: { tone: PulseTone; size?: number; bold?: boolean; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const t = TONE[tone];
  const preset = presetFor(size);
  const scale = size / preset;
  return (
    <span
      aria-hidden
      className={['pulse-orb', bold && 'pulse-orb--bold', className].filter(Boolean).join(' ')}
      data-tone={tone}
      style={{ width: size, height: size, '--orb-tint': t.color } as React.CSSProperties}
    >
      <span className="pulse-orb-draw" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <ThinkingOrb state={t.state} size={preset} theme="auto" color={t.color} speed={t.speed} paused={reduced} dotSize={bold ? 2.4 : 1} dots={bold ? 1.1 : 1} />
      </span>
    </span>
  );
}

/** Health band -> orb tone. */
export function toneForBand(band: string): PulseTone {
  return band === 'strong' || band === 'good' ? 'calm' : band === 'needs_attention' ? 'watch' : 'alert';
}
