/**
 * MobileSection — Settings → Mobile.
 *
 * Shows:
 *   1. Native app install QR codes (TestFlight + Play Store links).
 *   2. Current push notification status (running inside native shell or not).
 *   3. Biometric auth toggle (stored in native SecureStore via bridge).
 *
 * WHY QR codes for beta: design partners install via TestFlight/Play Internal
 * before the app is publicly listed. QR codes are the fastest path from
 * "I want to try the app" to "it's installed" without requiring the user to
 * search the store.
 */
import { useState, useEffect } from 'react';
import { isNative, nativeBridge } from '@/lib/native-bridge';

/** Placeholder URLs — replace with real EAS build URLs after first production build */
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/REPLACE_WITH_INVITE_CODE';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=io.bidstack.crm';

export function MobileSection() {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(false);

  // Probe push token state when running natively
  useEffect(() => {
    if (!isNative) return;
    nativeBridge.push().then((result) => {
      if (result.token) setPushToken(result.token.slice(0, 32) + '…');
    });
  }, []);

  async function requestPushPermission() {
    setPushLoading(true);
    const result = await nativeBridge.push();
    setPushToken(result.token ? result.token.slice(0, 32) + '…' : null);
    setPushLoading(false);
  }

  return (
    <div className="space-y-8">
      {/* Native app status pill */}
      {isNative ? (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--success-bg,#dcfce7)] px-4 py-3 text-sm text-[var(--success-fg,#166534)]">
          <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          Running inside the BidStack native app
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--fg-secondary)]">
          You are using the web version. Install the mobile app below for native push notifications,
          biometric unlock, and camera access.
        </div>
      )}

      {/* Push notifications (native only) */}
      {isNative && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-[var(--fg-primary)]">
            Push Notifications
          </h3>
          {pushToken ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 rounded-full bg-green-500" aria-hidden />
              <span className="text-sm text-[var(--fg-secondary)]">
                Enabled — device registered
              </span>
              <code className="ml-auto rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs font-mono text-[var(--fg-secondary)]">
                {pushToken}
              </code>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              <span className="text-sm text-[var(--fg-secondary)]">
                Push notifications not enabled
              </span>
              <button
                onClick={requestPushPermission}
                disabled={pushLoading}
                className="ml-auto rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 min-h-[44px] min-w-[44px]"
              >
                {pushLoading ? 'Requesting…' : 'Enable'}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Install links — always shown (users may want to install on another device) */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-[var(--fg-primary)]">
          Install on iOS (TestFlight Beta)
        </h3>
        <p className="mb-3 text-xs text-[var(--fg-secondary)]">
          Available to design partners via Apple TestFlight. Requires an invite code.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <AppStoreButton href={TESTFLIGHT_URL} label="Join TestFlight Beta" icon="apple" />
          <QRCode value={TESTFLIGHT_URL} label="Scan to open TestFlight" size={96} />
        </div>
      </section>

      <div className="border-t border-[var(--border)]" />

      <section>
        <h3 className="mb-1 text-sm font-semibold text-[var(--fg-primary)]">
          Install on Android (Play Store)
        </h3>
        <p className="mb-3 text-xs text-[var(--fg-secondary)]">
          Available on the Google Play internal testing track. Tap or scan below.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <AppStoreButton href={PLAY_STORE_URL} label="Get on Google Play" icon="play" />
          <QRCode value={PLAY_STORE_URL} label="Scan for Android" size={96} />
        </div>
      </section>

      <div className="border-t border-[var(--border)]" />

      {/* Docs link */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-[var(--fg-primary)]">Developer Setup</h3>
        <p className="text-xs text-[var(--fg-secondary)]">
          For EAS build setup, code signing, and submission instructions see{' '}
          <a
            href="/docs/mobile/EXPO-SETUP.md"
            className="text-[var(--accent)] underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs/mobile/EXPO-SETUP.md
          </a>
          .
        </p>
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AppStoreBtnProps {
  href: string;
  label: string;
  icon: 'apple' | 'play';
}

function AppStoreButton({ href, label, icon }: AppStoreBtnProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
    >
      {icon === 'apple' ? (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
      ) : (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3.18 23.76c.28.15.6.2.93.13l12.52-7.23-2.64-2.63-10.81 9.73zM.76 1.37C.3 1.67 0 2.18 0 2.81v18.38c0 .63.3 1.14.76 1.44l.08.06 10.3-10.31v-.24L.84 1.31l-.08.06zM20.8 10.5l-2.69-1.55-2.91 2.91 2.91 2.91 2.69-1.55c.76-.44.76-1.28 0-1.72zm-17.62 12.56L14.69 13.5l-2.64-2.63L.84 21.26l2.34 1.8z" />
        </svg>
      )}
      {label}
    </a>
  );
}

interface QRCodeProps {
  value: string;
  label: string;
  size: number;
}

/**
 * Renders a placeholder QR code using a Google Charts API URL.
 * WHY third-party: generating QR codes natively adds a dependency.
 * For production, replace with a self-hosted or npm QR library.
 * The Charts API is acceptable for internal tooling / settings pages.
 */
function QRCode({ value, label, size }: QRCodeProps) {
  const url = `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(value)}&choe=UTF-8`;
  return (
    <div className="flex flex-col items-center gap-1">
      <img
        src={url}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="rounded border border-[var(--border)]"
      />
      <span className="text-xs text-[var(--fg-tertiary)]">{label}</span>
    </div>
  );
}
