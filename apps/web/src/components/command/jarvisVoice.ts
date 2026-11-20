/**
 * Web Speech helpers for Jarvis. Recognition and synthesis both run in the
 * browser; no audio is recorded or uploaded by Polo. Browsers without the
 * API get a text-only panel.
 */

export const JARVIS_MUTE_KEY = 'polo.jarvis.muted';

/** Minimal surface of SpeechRecognition that Jarvis uses. */
export interface JarvisRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: JarvisRecognitionEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export interface JarvisRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

export type JarvisRecognitionCtor = new () => JarvisRecognition;

export function getSpeechRecognitionCtor(win: Window): JarvisRecognitionCtor | null {
  const w = win as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === 'function' ? (ctor as JarvisRecognitionCtor) : null;
}

export function canSpeak(win: Window): boolean {
  const w = win as unknown as Record<string, unknown>;
  return Boolean(w.speechSynthesis) && typeof w.SpeechSynthesisUtterance === 'function';
}

export function readJarvisMuted(): boolean {
  try {
    return localStorage.getItem(JARVIS_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeJarvisMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(JARVIS_MUTE_KEY, '1');
    else localStorage.removeItem(JARVIS_MUTE_KEY);
  } catch {
    // Private mode or blocked storage: the toggle still works for this session.
  }
}

/** Reads `text` aloud, replacing anything already being spoken. */
export function speak(win: Window, text: string, lang: string): void {
  if (!canSpeak(win) || !text.trim()) return;
  const Utterance = (win as unknown as { SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance;
  const utterance = new Utterance(text);
  utterance.lang = lang;
  win.speechSynthesis.cancel();
  win.speechSynthesis.speak(utterance);
}

export function stopSpeaking(win: Window): void {
  if (canSpeak(win)) win.speechSynthesis.cancel();
}
