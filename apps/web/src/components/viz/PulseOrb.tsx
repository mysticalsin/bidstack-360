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

export function PulseOrb({ tone, size = 32, className }: { tone: PulseTone; size?: OrbSize; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const t = TONE[tone];
  return (
    <span aria-hidden className={['pulse-orb', className].filter(Boolean).join(' ')} data-tone={tone}>
      <ThinkingOrb state={t.state} size={size} theme="auto" color={t.color} speed={t.speed} paused={reduced} />
    </span>
  );
}

/** Health band -> orb tone. */
export function toneForBand(band: string): PulseTone {
  return band === 'strong' || band === 'good' ? 'calm' : band === 'needs_attention' ? 'watch' : 'alert';
}
