import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FILE_MAX_BYTES, inferAllowedFileContentType } from '@bidstack/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
  const { readFileSync: read } = await import('node:fs');
  const { resolve } = await import('node:path');
  const en = JSON.parse(read(resolve(process.cwd(), 'public/locales/en/crm.json'), 'utf8')) as {
    files?: { acceptedFormats?: string };
  };
  return {
    useTranslation: () => ({
      t: (key: string, fallback?: string) => {
        const [group, name] = key.split('.');
        const table = en as Record<string, Record<string, string> | undefined>;
        const value = table[group ?? '']?.[name ?? ''];
        if (typeof value === 'string') return value;
        return typeof fallback === 'string' ? fallback : key;
      },
    }),
  };
});

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({
    data: { items: [], itemsContinue: false },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUploadFile: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteFile: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { FilesPanel } from './FilesPanel';

function localeCaption(lang: string): string {
  const crm = JSON.parse(
    readFileSync(path.resolve(process.cwd(), `public/locales/${lang}/crm.json`), 'utf8'),
  ) as { files: { acceptedFormats: string } };
  return crm.files.acceptedFormats;
}

const maxMb = FILE_MAX_BYTES / (1024 * 1024);

describe('account file dropzone on an empty demo account', () => {
  afterEach(() => {
    cleanup();
  });

  it('names every family the picker accepts, including a deck and a csv', () => {
    // WHY: demo seed attaches no account files, so this dropzone is the upload
    // guide on every account. It said "PDF, DOCX, XLSX, images" while the
    // picker and the API also take a proposal deck, a csv, audio, and video.
    // A person who believed the line would not upload those files.
    expect(maxMb).toBe(50);
    expect(inferAllowedFileContentType('quarterly-deck.pptx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(inferAllowedFileContentType('pricing.csv', 'text/csv')).toBe('text/csv');
    expect(inferAllowedFileContentType('call.mp3', 'audio/mpeg')).toBe('audio/mpeg');
    expect(inferAllowedFileContentType('walkthrough.mp4', 'video/mp4')).toBe('video/mp4');
    expect(inferAllowedFileContentType('payload.exe', 'application/octet-stream')).toBeNull();

    render(<FilesPanel accountId="demo-account" />);
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const accept = input?.getAttribute('accept') ?? '';
    expect(accept).toContain('.pptx');
    expect(accept).toContain('.csv');
    expect(accept).toContain('.mp3');
    expect(accept).toContain('.mp4');
    expect(accept).not.toContain('.exe');

    const expected = `PDF, Office, text/data, image, audio, or video, up to ${maxMb} MB`;
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(/DOCX, XLSX, images/)).toBeNull();
    expect(localeCaption('en')).toBe(expected);
    expect(localeCaption('en')).not.toContain('\u2014');
    expect(localeCaption('en')).not.toContain('\u00a0');

    expect(localeCaption('fr')).toBe(
      `PDF, Office, texte/données, image, audio ou vidéo, jusqu'à ${maxMb} Mo`,
    );
    expect(localeCaption('es')).toBe(
      `PDF, Office, texto/datos, imagen, audio o vídeo, hasta ${maxMb} MB`,
    );
    expect(localeCaption('pt')).toBe(
      `PDF, Office, texto/dados, imagem, áudio ou vídeo, até ${maxMb} MB`,
    );
    expect(localeCaption('it')).toBe(
      `PDF, Office, testo/dati, immagine, audio o video, fino a ${maxMb} MB`,
    );
    expect(localeCaption('zh')).toBe(
      `PDF、Office、文本/数据、图片、音频或视频，最大 ${maxMb} MB`,
    );
    for (const lang of ['fr', 'es', 'pt', 'it', 'zh'] as const) {
      expect(localeCaption(lang)).not.toMatch(/DOCX, XLSX|DOCX、XLSX/);
      expect(localeCaption(lang)).not.toContain('\u2014');
    }
  });
});
