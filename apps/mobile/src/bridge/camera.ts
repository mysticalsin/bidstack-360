/**
 * Camera bridge — wraps expo-camera.
 *
 * WHY base64 output: the web layer receives images via the JS bridge
 * message channel. Data URIs are the only practical way to transfer binary
 * across the webview boundary without a file:// scheme (which is sandboxed).
 * For large attachments the web layer should POST to /api/files directly.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

export interface CaptureResult {
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  uri: string;
}

export interface CameraError {
  code: 'permission_denied' | 'cancelled' | 'unknown';
  message: string;
}

/** Open the image picker (gallery or camera). Returns base64 JPEG. */
export async function pickImage(
  source: 'camera' | 'gallery',
): Promise<{ ok: true; data: CaptureResult } | { ok: false; error: CameraError }> {
  if (source === 'camera') {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      return {
        ok: false,
        error: { code: 'permission_denied', message: 'Camera permission denied.' },
      };
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      // WHY base64: see module docstring
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.length) {
      return { ok: false, error: { code: 'cancelled', message: 'User cancelled.' } };
    }

    const asset = result.assets[0];
    if (!asset.base64) {
      return { ok: false, error: { code: 'unknown', message: 'No base64 data returned.' } };
    }

    return {
      ok: true,
      data: {
        base64: asset.base64,
        mimeType: 'image/jpeg',
        width: asset.width,
        height: asset.height,
        uri: asset.uri,
      },
    };
  }

  // Gallery flow
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    return {
      ok: false,
      error: { code: 'permission_denied', message: 'Photo library permission denied.' },
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
    base64: true,
    allowsEditing: false,
    allowsMultipleSelection: false,
  });

  if (result.canceled || !result.assets?.length) {
    return { ok: false, error: { code: 'cancelled', message: 'User cancelled.' } };
  }

  const asset = result.assets[0];
  if (!asset.base64) {
    return { ok: false, error: { code: 'unknown', message: 'No base64 data returned.' } };
  }

  return {
    ok: true,
    data: {
      base64: asset.base64,
      mimeType: 'image/jpeg',
      width: asset.width,
      height: asset.height,
      uri: asset.uri,
    },
  };
}
