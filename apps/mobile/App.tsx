/**
 * BidStack 360° — Expo native shell.
 *
 * Architecture:
 *   - WebView loads the production PWA (EXPO_PUBLIC_APP_URL).
 *   - JS bridge injects window.bidstackNative so the web layer can call
 *     native capabilities without knowing it's running in a WebView.
 *   - Biometric gate (opt-in) prevents the WebView from rendering until
 *     the user authenticates with Face ID / Touch ID.
 *   - Push registration happens after unlock and posts the Expo token to
 *     /api/notifications/native-push/register.
 *   - Deep links (bidstack://) are validated against an allowlist before
 *     being injected into the WebView as a navigation action.
 *
 * Security notes:
 *   - Deep link allowlist prevents phishing via external bidstack:// links.
 *   - EXPO_PUBLIC_APP_URL is the only origin the WebView will load from.
 *   - Biometric defaults OFF; user must opt in via BidStack Settings → Mobile.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as SplashScreen from 'expo-splash-screen';
import * as Haptics from 'expo-haptics';

import { BiometricGate } from './src/components/BiometricGate';
import { NetworkBanner } from './src/components/NetworkBanner';
import {
  authenticate,
  checkBiometricCapability,
  isBiometricEnabled,
  type BiometricType,
} from './src/bridge/biometric';
import {
  configureNotificationHandler,
  registerForPushNotifications,
  clearBadge,
} from './src/bridge/notifications';
import { pickImage } from './src/bridge/camera';
import { pickDocument } from './src/bridge/file';
import { shareNative } from './src/bridge/share';

// Keep splash visible until we know whether to show the biometric gate
SplashScreen.preventAutoHideAsync();

// Configure foreground notification display at module load time
configureNotificationHandler();

// ── Constants ───────────────────────────────────────────────────────────────

const APP_URL = process.env.EXPO_PUBLIC_APP_URL ?? 'https://app.bidstack.io';

/**
 * Allowlist of hosts that deep links are permitted to resolve to.
 * WHY: bidstack:// links can be crafted by any app. We validate the path
 * prefix to prevent an external link from navigating the user to a
 * phishing page inside their authenticated session.
 */
const DEEP_LINK_ALLOWED_PATHS = new Set([
  '/deal',
  '/opportunity',
  '/contact',
  '/company',
  '/lead',
  '/task',
  '/proposal',
]);

// ── JS bridge injected into every WebView page ──────────────────────────────

/**
 * WHY postMessage/onMessage pattern: WebView does not expose direct function
 * calls across the boundary. We inject a thin JS API that wraps postMessage,
 * and the native side responds by calling injectJavaScript.
 */
const BRIDGE_INJECTION_JS = `
(function() {
  if (window.bidstackNative) return; // idempotent

  var _callbacks = {};
  var _seq = 0;

  function call(action, payload) {
    return new Promise(function(resolve) {
      var id = ++_seq;
      _callbacks[id] = resolve;
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: id, action: action, payload: payload || {} }));
    });
  }

  // Response handler — native calls window._bidstackResolve(id, result)
  window._bidstackResolve = function(id, result) {
    var cb = _callbacks[id];
    if (cb) { delete _callbacks[id]; cb(result); }
  };

  window.bidstackNative = {
    /** Trigger vibration / haptic feedback. impact: 'light' | 'medium' | 'heavy' */
    vibrate: function(impact) { return call('vibrate', { impact: impact }); },
    /** Request native biometric re-auth (returns { success: boolean }). */
    biometric: function(reason) { return call('biometric', { reason: reason }); },
    /** Open native camera or gallery. source: 'camera' | 'gallery' */
    camera: function(source) { return call('camera', { source: source }); },
    /** Open native document picker (returns { name, mimeType, size, base64 }). */
    file: function() { return call('file', {}); },
    /** Native share sheet. */
    share: function(payload) { return call('share', payload); },
    /** Request push permission + return Expo token string. */
    push: function() { return call('push', {}); },
    /** Open URL in system browser (not inside WebView). */
    openExternal: function(url) { return call('openExternal', { url: url }); },
    /** Navigate the WebView to a path (used by deep links). */
    navigate: function(path) { return call('navigate', { path: path }); },
  };

  // Notify the web layer that native bridge is ready
  window.dispatchEvent(new Event('bidstackNativeReady'));
})();
true; // required by react-native-webview
`;

// ── Types ────────────────────────────────────────────────────────────────────

interface BridgeMessage {
  id: number;
  action: string;
  payload: Record<string, unknown>;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const webViewRef = useRef<WebView>(null);

  // Biometric state
  const [biometricType, setBiometricType] = useState<BiometricType>('none');
  const [requiresBiometric, setRequiresBiometric] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  // ── Initialisation ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Check biometric capability and opt-in state
      const [capability, enabled] = await Promise.all([
        checkBiometricCapability(),
        isBiometricEnabled(),
      ]);

      if (capability.available && capability.enrolled && enabled) {
        setBiometricType(capability.type);
        setRequiresBiometric(true);
      } else {
        // No biometric gate — go straight to WebView
        setUnlocked(true);
      }

      await SplashScreen.hideAsync();
    })();
  }, []);

  // Deep link listener
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => injectDeepLink(url);
    const sub = Linking.addEventListener('url', handleUrl);

    // Handle cold-start deep links
    Linking.getInitialURL().then((url) => {
      if (url) injectDeepLink(url);
    });

    return () => sub.remove();
  }, []);

  // ── Deep link validation ─────────────────────────────────────────────────

  function injectDeepLink(url: string) {
    try {
      // bidstack://deal/123  →  /deal/123
      const parsed = new URL(url);
      if (parsed.protocol !== 'bidstack:') return;

      const path = '/' + parsed.hostname + parsed.pathname;

      // Validate against allowlist — prevents arbitrary path injection
      const allowed = [...DEEP_LINK_ALLOWED_PATHS].some((prefix) => path.startsWith(prefix));
      if (!allowed) {
        // WHY warn but don't error: a typo in a link shouldn't crash the shell
        console.warn('[deep-link] rejected path:', path);
        return;
      }

      webViewRef.current?.injectJavaScript(
        `window.history.pushState({}, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); true;`,
      );
    } catch {
      // Malformed URL — silently ignore
    }
  }

  // ── Bridge message handler ───────────────────────────────────────────────

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeMessage;
    } catch {
      return; // Non-bridge message (e.g. from analytics scripts)
    }

    const { id, action, payload } = msg;

    function resolve(result: unknown) {
      webViewRef.current?.injectJavaScript(
        `window._bidstackResolve(${id}, ${JSON.stringify(result)}); true;`,
      );
    }

    switch (action) {
      case 'vibrate': {
        const impact = payload.impact as string;
        await Haptics.impactAsync(
          impact === 'heavy'
            ? Haptics.ImpactFeedbackStyle.Heavy
            : impact === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
        );
        resolve({ ok: true });
        break;
      }

      case 'biometric': {
        const result = await authenticate(payload.reason as string | undefined);
        resolve(result);
        break;
      }

      case 'camera': {
        const result = await pickImage(payload.source as 'camera' | 'gallery');
        resolve(result);
        break;
      }

      case 'file': {
        const result = await pickDocument();
        resolve(result);
        break;
      }

      case 'share': {
        const result = await shareNative({
          title: payload.title as string | undefined,
          message: payload.message as string,
          url: payload.url as string | undefined,
        });
        resolve(result);
        break;
      }

      case 'push': {
        const token = await registerForPushNotifications();
        resolve({ token: token?.token ?? null });
        break;
      }

      case 'openExternal': {
        const url = payload.url as string;
        // WHY check canOpenURL: avoids silent failures on restricted schemes
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) await Linking.openURL(url);
        resolve({ opened: canOpen });
        break;
      }

      case 'navigate': {
        injectDeepLink(`bidstack:/${payload.path as string}`);
        resolve({ ok: true });
        break;
      }

      default:
        resolve({ error: `unknown_action: ${action}` });
    }
  }, []);

  // ── Pull-to-refresh ──────────────────────────────────────────────────────

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Increment key forces WebView remount (full reload)
    setWebViewKey((k) => k + 1);
    // Give the webview 500ms to start before clearing the spinner
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  if (requiresBiometric && !unlocked) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <BiometricGate biometricType={biometricType} onUnlocked={() => setUnlocked(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <NetworkBanner />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >
        {unlocked ? (
          <WebView
            key={webViewKey}
            ref={webViewRef}
            source={{ uri: APP_URL }}
            style={styles.webview}
            // Inject bridge before any page JS runs
            injectedJavaScriptBeforeContentLoaded={BRIDGE_INJECTION_JS}
            onMessage={handleMessage}
            // WHY allowsBackForwardNavigationGestures: mobile UX expectation
            allowsBackForwardNavigationGestures
            // WHY sharedCookiesEnabled: Clerk session cookies must persist
            sharedCookiesEnabled
            // WHY javaScriptEnabled: the entire app is a JS SPA
            javaScriptEnabled
            // WHY domStorageEnabled: PWA uses localStorage for offline queue
            domStorageEnabled
            // Prevent the WebView from navigating away from the app URL
            onShouldStartLoadWithRequest={(request) => {
              const isAppOrigin = request.url.startsWith(APP_URL);
              const isDataUri = request.url.startsWith('data:');
              const isAboutBlank = request.url === 'about:blank';

              if (!isAppOrigin && !isDataUri && !isAboutBlank) {
                // Open external URLs in the system browser
                Linking.openURL(request.url).catch(() => null);
                return false;
              }
              return true;
            }}
            onLoadEnd={() => {
              clearBadge().catch(() => null);
            }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
