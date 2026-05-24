/**
 * native-bridge.ts — typed interface to the native shell's JS bridge.
 *
 * Usage:
 *   import { isNative, nativeBridge } from '@/lib/native-bridge';
 *
 *   if (isNative) {
 *     const result = await nativeBridge.camera('camera');
 *   } else {
 *     // fall back to web APIs
 *   }
 *
 * Detection: checks for window.bidstackNative, which is injected by App.tsx
 * before page JS runs. Outside the native WebView this is undefined.
 *
 * WHY not just check userAgent: UA sniffing is unreliable and easy to spoof.
 * The presence of the bridge object is an authoritative signal.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CaptureResult {
  ok: boolean;
  data?: {
    base64: string;
    mimeType: 'image/jpeg';
    width: number;
    height: number;
    uri: string;
  };
  error?: { code: string; message: string };
}

export interface FileResult {
  ok: boolean;
  data?: {
    name: string;
    mimeType: string;
    size: number;
    base64: string;
    uri: string;
  };
  error?: { code: string; message: string };
}

export interface BiometricResult {
  success: boolean;
  error?: string;
}

export interface ShareResult {
  shared: boolean;
  action: string;
}

export interface PushResult {
  token: string | null;
}

export interface SharePayload {
  title?: string;
  message: string;
  url?: string;
}

export interface VibrationImpact {
  impact: 'light' | 'medium' | 'heavy';
}

/**
 * Shape of window.bidstackNative injected by the Expo shell (App.tsx).
 * All methods return Promises — the bridge is always async.
 */
interface BidstackNativeAPI {
  vibrate(impact?: 'light' | 'medium' | 'heavy'): Promise<{ ok: boolean }>;
  biometric(reason?: string): Promise<BiometricResult>;
  camera(source: 'camera' | 'gallery'): Promise<CaptureResult>;
  file(): Promise<FileResult>;
  share(payload: SharePayload): Promise<ShareResult>;
  push(): Promise<PushResult>;
  openExternal(url: string): Promise<{ opened: boolean }>;
  navigate(path: string): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    bidstackNative?: BidstackNativeAPI;
    /** Native bridge fires this event once injected. */
    addEventListener(
      type: 'bidstackNativeReady',
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * True when running inside the BidStack Expo native shell.
 * Reactive: the bridge is injected before page JS, so this is reliable
 * at module load time.
 */
export const isNative: boolean = typeof window !== 'undefined' && !!window.bidstackNative;

// ── Typed helper wrappers ────────────────────────────────────────────────────

/**
 * nativeBridge — typed wrappers that fall back gracefully when not in native.
 *
 * Each method checks isNative and falls back to a web-equivalent where
 * one exists, or returns a sensible no-op result otherwise.
 */
export const nativeBridge = {
  /**
   * Haptic feedback. Falls back to navigator.vibrate (200ms) on web.
   */
  vibrate(impact: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.vibrate(impact).then(() => undefined);
    }
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(impact === 'heavy' ? 300 : impact === 'medium' ? 150 : 50);
    }
    return Promise.resolve();
  },

  /**
   * Biometric re-auth prompt. Returns { success: false } on web (no equivalent).
   */
  biometric(reason?: string): Promise<BiometricResult> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.biometric(reason);
    }
    return Promise.resolve({ success: false, error: 'biometric_unavailable' });
  },

  /**
   * Open native camera or gallery. Falls back to HTML input[type=file] on web.
   */
  async camera(source: 'camera' | 'gallery'): Promise<CaptureResult> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.camera(source);
    }
    // Web fallback: open file picker
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.capture = 'environment';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false, error: { code: 'cancelled', message: 'No file selected.' } });
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          // Strip the data:image/jpeg;base64, prefix
          const base64 = dataUrl.split(',')[1] ?? '';
          resolve({
            ok: true,
            data: { base64, mimeType: 'image/jpeg', width: 0, height: 0, uri: dataUrl },
          });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },

  /**
   * Open native document picker. Falls back to HTML input[type=file] on web.
   */
  async file(): Promise<FileResult> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.file();
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ ok: false, error: { code: 'cancelled', message: 'No file selected.' } });
          return;
        }
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(arrayBuffer)),
        );
        resolve({
          ok: true,
          data: { name: file.name, mimeType: file.type, size: file.size, base64, uri: '' },
        });
      };
      input.click();
    });
  },

  /**
   * Native share sheet. Falls back to navigator.share, then clipboard copy.
   */
  async share(payload: SharePayload): Promise<ShareResult> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.share(payload);
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: payload.title,
          text: payload.message,
          url: payload.url,
        });
        return { shared: true, action: 'shared' };
      } catch {
        return { shared: false, action: 'dismissed' };
      }
    }
    // Last resort: clipboard
    const text = payload.url ? `${payload.message}\n${payload.url}` : payload.message;
    await navigator.clipboard?.writeText(text).catch(() => null);
    return { shared: true, action: 'clipboard' };
  },

  /**
   * Request Expo push token. Returns null on web.
   */
  push(): Promise<PushResult> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.push();
    }
    return Promise.resolve({ token: null });
  },

  /**
   * Open a URL in the system browser (outside the WebView / current tab).
   */
  openExternal(url: string): Promise<{ opened: boolean }> {
    if (isNative && window.bidstackNative) {
      return window.bidstackNative.openExternal(url);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve({ opened: true });
  },
};
