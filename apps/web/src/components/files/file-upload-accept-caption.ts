import { FILE_MAX_BYTES } from '@bidstack/shared';

/**
 * Account file dropzone line. Demo accounts have no attachments, so this
 * sentence is the upload guide. It names every family the picker and the
 * API allow. A shorter list hid a proposal deck, a csv, audio, and video.
 */
export function fileUploadAcceptCaption(maxBytes: number = FILE_MAX_BYTES): string {
  const maxMb = maxBytes / (1024 * 1024);
  return `PDF, Office, text/data, image, audio, or video, up to ${maxMb} MB`;
}
