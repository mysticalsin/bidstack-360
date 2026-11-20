import { describe, expect, it } from 'vitest';

import {
  FILE_INPUT_ACCEPT,
  FileUploadUrlRequest,
  inferAllowedFileContentType,
  isAllowedFileContentType,
} from './file.js';

describe('file upload content-type contract', () => {
  it('infers safe document types when browsers provide an empty MIME type', () => {
    expect(inferAllowedFileContentType('rfp.docx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(inferAllowedFileContentType('pricing.xlsx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(inferAllowedFileContentType('scan.heic', '')).toBe('image/heic');
    expect(inferAllowedFileContentType('briefing.mp3', '')).toBe('audio/mpeg');
    expect(inferAllowedFileContentType('site-visit.mov', '')).toBe('video/quicktime');
  });

  it('keeps risky executable/script uploads outside the CRM document intake surface', () => {
    expect(inferAllowedFileContentType('payload.exe', '')).toBeNull();
    expect(isAllowedFileContentType('image/svg+xml')).toBe(false);
    // D5: HTML on the account-file allow-list was stored XSS on the API
    // origin. Org-chart HTML import is a separate, dedicated path.
    expect(isAllowedFileContentType('text/html')).toBe(false);
    expect(inferAllowedFileContentType('note.html', 'text/html')).toBeNull();
    expect(inferAllowedFileContentType('note.htm', '')).toBeNull();
    expect(
      FileUploadUrlRequest.safeParse({
        accountId: 'acme',
        name: 'note.html',
        contentType: 'text/html',
        bytes: 100,
      }).success,
    ).toBe(false);
    expect(
      FileUploadUrlRequest.safeParse({
        accountId: 'acme',
        name: 'payload.exe',
        contentType: 'application/x-msdownload',
        bytes: 100,
      }).success,
    ).toBe(false);
  });

  it('exports one browser accept string for account files, intake, and RFP uploads', () => {
    expect(FILE_INPUT_ACCEPT).toContain('.pdf');
    expect(FILE_INPUT_ACCEPT).toContain('.docx');
    expect(FILE_INPUT_ACCEPT).toContain('.heic');
    expect(FILE_INPUT_ACCEPT).toContain('.mp4');
    expect(FILE_INPUT_ACCEPT).toContain('application/pdf');
  });
});
