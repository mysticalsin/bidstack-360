import { describe, expect, it } from 'vitest';

import { SIGNING_ENTITY_CATALOG } from './signing-entities.catalog.js';
import { extractMsaFields } from './extract-fields.js';
import { rankSigningEntityMatches } from './match-signing-entity.js';
import { SYNTHETIC_NORTHWIND_MSA_TEXT } from './synthetic-msa.js';

describe('rankSigningEntityMatches', () => {
  it('recognises HEMA aliases in the parties clause', () => {
    const fields = extractMsaFields(SYNTHETIC_NORTHWIND_MSA_TEXT);
    const matches = rankSigningEntityMatches(
      SIGNING_ENTITY_CATALOG.map((e) => ({
        id: null,
        slug: e.slug,
        name: e.name,
        legalName: e.legalName,
        aliases: e.aliases,
      })),
      fields,
    );
    expect(matches[0]?.slug).toBe('hema');
    expect(matches[0]?.scoreBps).toBeGreaterThanOrEqual(9000);
  });
});
