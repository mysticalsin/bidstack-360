import { describe, expect, it } from 'vitest';

import { classifyDocument, isExtractableForIntel } from './document-category.js';

describe('classifyDocument', () => {
  it('tags master service agreements as msa (before the generic proposal rule)', () => {
    expect(classifyDocument('Acme MSA 2026.pdf')).toBe('msa');
    expect(classifyDocument('Master Service Agreement - Acme.docx')).toBe('msa');
    expect(classifyDocument('Framework Agreement v3.pdf')).toBe('msa');
  });

  it('tags rate cards and price lists', () => {
    expect(classifyDocument('Rate Card Q1.xlsx')).toBe('rate_card');
    expect(classifyDocument('acme-price-list.pdf')).toBe('rate_card');
    expect(classifyDocument('Pricing Workbook.xlsx')).toBe('rate_card');
  });

  it('tags NDAs', () => {
    expect(classifyDocument('NDA - Acme.pdf')).toBe('nda');
    expect(classifyDocument('Non-Disclosure Agreement.docx')).toBe('nda');
  });

  it('tags win/loss debriefs — the documents we learn patterns from', () => {
    expect(classifyDocument('Bid Debrief Acme.docx')).toBe('win_loss');
    expect(classifyDocument('Win-Loss review 2026.pdf')).toBe('win_loss');
    expect(classifyDocument('Award Notification.pdf')).toBe('win_loss');
  });

  it('tags RFPs / tenders', () => {
    expect(classifyDocument('RFP Acme Cloud.pdf')).toBe('rfp');
    expect(classifyDocument('Invitation to Tender.pdf')).toBe('rfp');
  });

  it('tags proposals / SOWs', () => {
    expect(classifyDocument('Proposal Acme.pdf')).toBe('proposal');
    expect(classifyDocument('Statement of Work.docx')).toBe('proposal');
  });

  it('falls back to other for unrelated files', () => {
    expect(classifyDocument('team-photo.png')).toBe('other');
    expect(classifyDocument('notes.txt')).toBe('other');
  });
});

describe('isExtractableForIntel', () => {
  it('accepts the text-extractable document types', () => {
    expect(isExtractableForIntel('application/pdf')).toBe(true);
    expect(
      isExtractableForIntel(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
    expect(isExtractableForIntel('text/plain')).toBe(true);
  });

  it('rejects spreadsheets and images (no parser yet) so they are not auto-extracted', () => {
    expect(isExtractableForIntel('application/vnd.ms-excel')).toBe(false);
    expect(isExtractableForIntel('image/png')).toBe(false);
    expect(isExtractableForIntel('application/json')).toBe(false);
  });
});
