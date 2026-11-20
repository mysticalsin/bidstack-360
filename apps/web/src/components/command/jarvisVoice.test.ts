// Voice is a progressive enhancement. Browsers without the Web Speech API
// (Firefox, most embedded webviews) must get a text-only Jarvis with no mic
// control, and the mute choice must survive a reload.
import { afterEach, describe, expect, it } from 'vitest';

import {
  JARVIS_MUTE_KEY,
  canSpeak,
  getSpeechRecognitionCtor,
  readJarvisMuted,
  writeJarvisMuted,
} from './jarvisVoice';

afterEach(() => {
  localStorage.clear();
});

describe('getSpeechRecognitionCtor', () => {
  it('returns null when the browser has no speech recognition', () => {
    expect(getSpeechRecognitionCtor({} as Window)).toBeNull();
  });

  it('uses the standard constructor when present', () => {
    class Std {}
    expect(getSpeechRecognitionCtor({ SpeechRecognition: Std } as unknown as Window)).toBe(Std);
  });

  it('falls back to the webkit-prefixed constructor', () => {
    class Webkit {}
    expect(
      getSpeechRecognitionCtor({ webkitSpeechRecognition: Webkit } as unknown as Window),
    ).toBe(Webkit);
  });
});

describe('canSpeak', () => {
  it('needs both speechSynthesis and SpeechSynthesisUtterance', () => {
    expect(canSpeak({} as Window)).toBe(false);
    expect(
      canSpeak({
        speechSynthesis: { speak: () => undefined },
        SpeechSynthesisUtterance: class {},
      } as unknown as Window),
    ).toBe(true);
  });
});

describe('mute preference', () => {
  it('defaults to not muted and persists in localStorage', () => {
    expect(readJarvisMuted()).toBe(false);
    writeJarvisMuted(true);
    expect(localStorage.getItem(JARVIS_MUTE_KEY)).toBe('1');
    expect(readJarvisMuted()).toBe(true);
    writeJarvisMuted(false);
    expect(readJarvisMuted()).toBe(false);
  });
});
