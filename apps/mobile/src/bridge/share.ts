/**
 * Share bridge — wraps the React Native Share API.
 *
 * WHY native share: the web Share API (navigator.share) is not available
 * inside WKWebView on iOS < 16.4 with some configurations. Delegating to
 * the native layer ensures consistent behaviour across iOS and Android.
 */
import { Share, Platform } from 'react-native';

export interface SharePayload {
  title?: string;
  message: string;
  url?: string;
}

export interface ShareResult {
  shared: boolean;
  /** 'dismissed' | 'shared' | platform-specific action string */
  action: string;
}

export async function shareNative(payload: SharePayload): Promise<ShareResult> {
  try {
    const result = await Share.share(
      {
        title: payload.title,
        message:
          Platform.OS === 'android' && payload.url
            ? `${payload.message}\n${payload.url}`
            : payload.message,
        url: payload.url, // iOS only
      },
      {
        dialogTitle: payload.title ?? 'Share from BidStack',
        subject: payload.title,
      },
    );

    return {
      shared: result.action !== Share.dismissedAction,
      action: result.action,
    };
  } catch {
    return { shared: false, action: 'error' };
  }
}
