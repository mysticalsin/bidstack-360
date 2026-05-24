/**
 * File bridge — wraps expo-document-picker.
 *
 * WHY chunked reading via FileSystem: document-picker gives a file URI, not
 * raw bytes. We read it via expo-file-system and encode to base64 so the
 * web layer can POST it to /api/files without needing native file access.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

export interface PickedFile {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
  uri: string;
}

export interface FilePickError {
  code: 'cancelled' | 'read_failed' | 'too_large' | 'unknown';
  message: string;
}

/** Max file size accepted: 50 MB. WHY: API route enforces 50 MB limit. */
const MAX_BYTES = 50 * 1024 * 1024;

export async function pickDocument(): Promise<
  { ok: true; data: PickedFile } | { ok: false; error: FilePickError }
> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) {
    return { ok: false, error: { code: 'cancelled', message: 'User cancelled.' } };
  }

  const asset = result.assets[0];
  if (!asset) {
    return { ok: false, error: { code: 'unknown', message: 'No asset returned.' } };
  }

  if (asset.size !== undefined && asset.size > MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `File exceeds 50 MB limit (got ${Math.round(asset.size / 1024 / 1024)} MB).`,
      },
    };
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return {
      ok: true,
      data: {
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? 0,
        base64,
        uri: asset.uri,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: 'read_failed', message: String(err) },
    };
  }
}
