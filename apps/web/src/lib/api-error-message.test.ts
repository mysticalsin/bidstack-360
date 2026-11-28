import { describe, expect, it } from 'vitest';

import { presentApiFailure } from './api-error-message';

const en = (_key: string, fallback: string) => fallback;

describe('presentApiFailure', () => {
  it('does not show schema compiler paths or Zod wording', () => {
    // WHY: the companies, opportunities, contacts, leads, tasks, and pipeline
    // pages print error.message. The live API answers a bad body with this
    // exact compiler sentence.
    const shown = presentApiFailure(
      400,
      'body/name Required, body/rows Expected array, received string',
      null,
      en,
    );
    expect(shown).toBe('Some fields need attention. Check them and try again.');
    expect(shown).not.toMatch(/body\/|Expected|received/);
  });

  it('does not show params/id Invalid uuid', () => {
    expect(presentApiFailure(400, 'params/id Invalid uuid', null, en)).not.toMatch(/params\/|uuid/);
  });

  it('keeps a sentence a route wrote on purpose', () => {
    expect(presentApiFailure(400, 'Parent company not found', null, en)).toBe(
      'Parent company not found',
    );
    expect(presentApiFailure(404, 'Company not found', null, en)).toBe('Company not found');
  });

  it('replaces an expired token and a dropped connection with the catalog sentence', () => {
    expect(presentApiFailure(401, 'Invalid or expired token', null, en)).toBe(
      'Your session expired. Sign in to continue.',
    );
    expect(presentApiFailure(0, 'Failed to fetch', null, en)).toBe(
      'Network error. Check your connection.',
    );
  });

  it('hides a stack and a storage key on a 500', () => {
    const shown = presentApiFailure(
      500,
      'Error: boom\n    at handler (/app/apps/api/src/routes/companies.ts:10:5) storageKey orgs/abc',
      null,
      en,
    );
    expect(shown).toBe('Something went wrong. Please try again.');
    expect(shown).not.toMatch(/companies\.ts|storageKey/);
  });

  it('uses the active locale instead of the English compiler sentence', () => {
    const fr = (key: string, fallback: string) =>
      key === 'errors.validation' ? 'Certains champs sont à corriger.' : fallback;
    expect(presentApiFailure(400, 'body/name Required', 'validation', fr)).toBe(
      'Certains champs sont à corriger.',
    );
  });
});
