import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as root from '../index.js';
import {
  CHILECOMPRA_ATTRIBUTION,
  CHILECOMPRA_ATTRIBUTION_UNMODIFIED,
  chileCompraAttribution,
} from './attribution.js';
import { BANNED_ACCUSATION_WORDS, REVIEW_FLAG_COPY } from './review-flags.js';

const MODULE_DIR = fileURLToPath(new URL('./', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name.startsWith('__') ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test(-helpers)?\.ts$|test-helpers\.ts$/.test(name) ? [path] : [];
  });
}

describe('ChileCompra attribution (pinned, shown on every data view)', () => {
  it('pins the exact Spanish strings from the spec', () => {
    expect(CHILECOMPRA_ATTRIBUTION).toBe(
      'Fuente: Dirección ChileCompra (Mercado Público). Datos procesados por Polo.',
    );
    expect(CHILECOMPRA_ATTRIBUTION_UNMODIFIED).toBe('Fuente de los datos: Dirección ChileCompra.');
    expect(chileCompraAttribution({ modified: false })).toBe(CHILECOMPRA_ATTRIBUTION_UNMODIFIED);
    expect(chileCompraAttribution({ modified: true })).toBe(CHILECOMPRA_ATTRIBUTION);
  });

  it('is exported from the web-safe root entry', () => {
    expect(root.CHILECOMPRA_ATTRIBUTION).toBe(CHILECOMPRA_ATTRIBUTION);
    expect(root.CHILECOMPRA_ATTRIBUTION_UNMODIFIED).toBe(CHILECOMPRA_ATTRIBUTION_UNMODIFIED);
  });

  it('does not pull node-only adapter code into the web-safe root entry', () => {
    expect('mercadoPublicoAdapter' in root).toBe(false);
    expect('createTaxIdHasher' in root).toBe(false);
  });
});

describe('review flags use neutral wording, never accusation', () => {
  it('pins the labels', () => {
    expect(REVIEW_FLAG_COPY.direct_award.label).toBe('Needs review: direct award');
    expect(REVIEW_FLAG_COPY.single_bidder.label).toBe('Single bidder');
  });

  it('contains none of the banned words in English or Spanish', () => {
    expect(BANNED_ACCUSATION_WORDS).toEqual(
      expect.arrayContaining(['suspicious', 'irregular', 'fraud', 'sospechoso', 'fraude']),
    );
    for (const copy of Object.values(REVIEW_FLAG_COPY)) {
      const text = `${copy.label} ${copy.description}`.toLowerCase();
      for (const word of BANNED_ACCUSATION_WORDS) expect(text).not.toContain(word);
    }
  });
});

describe('hard safeguards (spec 6.1)', () => {
  const files = sourceFiles(MODULE_DIR);

  it('scans the adapter sources', () => {
    expect(files.some((f) => f.endsWith('mercadopublico-api.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('ocds-api.ts'))).toBe(true);
  });

  it.each(files)('%s issues no non-GET request', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i);
  });

  it.each(files)('%s never logs', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});
