/**
 * Notifications bridge — manages Expo push tokens and background notification
 * routing.
 *
 * WHY Expo Push Service: single integration point covers both APNs (iOS) and
 * FCM (Android). No separate APNs certificate handling in-app — EAS handles
 * signing at build time; runtime only needs to register and forward the token.
 *
 * Registration flow:
 *   1. App.tsx calls registerForPushNotifications() on startup.
 *   2. Token is sent to /api/notifications/native-push/register (Fastify route).
 *   3. Worker uses expo-server-sdk to fan-out push messages in batches of 100.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Sentry stub — wired in W7-5
const Sentry = {
  captureException: (err: unknown) => {
    // TODO(W7-5): replace with real @sentry/react-native call
    if (__DEV__) console.warn('[Sentry stub]', err);
  },
};

export interface PushToken {
  token: string;
  type: 'expo' | 'apns' | 'fcm';
}

/**
 * Configures notification handler so foreground alerts are visible.
 * Must be called at module load time (outside of any component).
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Requests permission and returns an Expo push token.
 * Returns null if the device is a simulator or permission is denied.
 */
export async function registerForPushNotifications(): Promise<PushToken | null> {
  if (!Device.isDevice) {
    // Simulators cannot receive real push notifications
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android requires a notification channel before Expo SDK 44
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'BidStack Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3B82F6',
    });
  }

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return { token: tokenData.data, type: 'expo' };
  } catch (err) {
    Sentry.captureException(err);
    return null;
  }
}

/**
 * POSTs the Expo push token to the BidStack API.
 * Caller must supply the org-scoped Bearer token.
 */
export async function sendTokenToServer(
  apiBaseUrl: string,
  bearerToken: string,
  pushToken: PushToken,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/notifications/native-push/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      token: pushToken.token,
      provider: 'EXPO',
      platform: Platform.OS,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    Sentry.captureException(
      new Error(`[notifications] token registration failed: ${res.status} ${text}`),
    );
  }
}

/**
 * Unregisters the device from push notifications.
 * Called when user signs out or disables push in settings.
 */
export async function unregisterFromServer(
  apiBaseUrl: string,
  bearerToken: string,
  pushToken: string,
): Promise<void> {
  await fetch(`${apiBaseUrl}/notifications/native-push/register`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ token: pushToken }),
  });
}

/** Clears the app badge count (iOS). */
export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
}
