import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_FILE_EMPTY,
  AGREEMENT_LIBRARY_EMPTY,
  AGREEMENT_LIBRARY_EMPTY_TITLE,
  AGREEMENT_REFERENCE_BADGE,
  AGREEMENT_UPLOAD_OFF,
  agreementReferenceNote,
} from './reference-copy';

// A seller reading an empty library or a fixture row should not be told the product is a demo.
const DEMO_COPY = /sample|demo|sandbox|fixture|illustrative|not live/i;

describe('agreement reference copy', () => {
  it('names the fixture badge and the empty library without demo language', () => {
    const lines = [
      AGREEMENT_REFERENCE_BADGE,
      AGREEMENT_UPLOAD_OFF,
      AGREEMENT_FILE_EMPTY,
      AGREEMENT_LIBRARY_EMPTY_TITLE,
      AGREEMENT_LIBRARY_EMPTY,
      agreementReferenceNote('agreements'),
      agreementReferenceNote('details'),
    ];
    expect(AGREEMENT_REFERENCE_BADGE).toBe('Reference');
    expect(AGREEMENT_UPLOAD_OFF).toMatch(/Uploads stay off for reference records/);
    expect(AGREEMENT_FILE_EMPTY).toBe('No file is stored for this reference record.');
    expect(AGREEMENT_LIBRARY_EMPTY_TITLE).toBe('No agreements on file');
    for (const line of lines) expect(line).not.toMatch(DEMO_COPY);
  });
});
