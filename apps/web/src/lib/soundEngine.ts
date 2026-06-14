// Tiny WebAudio sound engine for UI feedback.
//
// WHY synthesised, not audio files: four short interaction sounds add zero bytes
// to the bundle, never 404, and stay crisp at any sample rate. Each is a brief
// (<160ms) enveloped tone or two — interaction-triggered ONLY, never ambient.
//
// The AudioContext is created lazily on the first play() — which always happens
// inside a user gesture (a click), satisfying browser autoplay policy. Every
// call is wrapped so a missing/locked AudioContext (SSR, jsdom, old browser)
// degrades to a silent no-op rather than throwing into a click handler.

export type UiSoundKind = 'click' | 'toggle' | 'success' | 'error';

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

interface ToneSpec {
  freq: number;
  /** Optional glide target — a short pitch ramp adds character to clicks. */
  freqEnd?: number;
  type?: OscillatorType;
  /** Seconds from now to start. */
  at?: number;
  /** Note length in seconds. */
  dur?: number;
  /** Peak gain before the master volume scales it (0..1). */
  peak?: number;
}

function tone(audio: AudioContext, master: GainNode, spec: ToneSpec): void {
  const { freq, freqEnd, type = 'sine', at = 0, dur = 0.08, peak = 0.5 } = spec;
  const t0 = audio.currentTime + at;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  // Fast attack, exponential decay to near-silence — a percussive, click-like
  // envelope that never pops (gain starts at ~0, not exactly 0).
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/**
 * Play a UI sound at the given master volume (0..1). Fire-and-forget; never
 * throws. A volume of 0 (or a missing AudioContext) is a silent no-op.
 */
export function playUiSound(kind: UiSoundKind, masterVolume = 0.4): void {
  if (masterVolume <= 0) return;
  const audio = getContext();
  if (!audio) return;
  try {
    // A context can start 'suspended' until the first gesture resumes it.
    if (audio.state === 'suspended') void audio.resume();

    const master = audio.createGain();
    // Keep the ceiling gentle — these are confirmations, not alarms.
    master.gain.value = Math.min(1, Math.max(0, masterVolume)) * 0.5;
    master.connect(audio.destination);

    switch (kind) {
      case 'click':
        tone(audio, master, { freq: 520, freqEnd: 360, type: 'triangle', dur: 0.045, peak: 0.5 });
        break;
      case 'toggle':
        tone(audio, master, { freq: 440, freqEnd: 660, type: 'triangle', dur: 0.06, peak: 0.5 });
        break;
      case 'success':
        tone(audio, master, { freq: 587.33, type: 'sine', dur: 0.09, peak: 0.5 }); // D5
        tone(audio, master, { freq: 880, type: 'sine', at: 0.08, dur: 0.12, peak: 0.5 }); // A5
        break;
      case 'error':
        tone(audio, master, { freq: 311.13, type: 'sawtooth', dur: 0.1, peak: 0.32 }); // D#4
        tone(audio, master, { freq: 196, type: 'sawtooth', at: 0.09, dur: 0.16, peak: 0.32 }); // G3
        break;
    }
  } catch {
    // WebAudio scheduling can throw on exotic states — stay silent.
  }
}
