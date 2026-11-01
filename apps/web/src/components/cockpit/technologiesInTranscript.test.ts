import { describe, expect, it } from 'vitest';

import { technologiesInTranscript } from './TechStackCard';

describe('technologiesInTranscript', () => {
  it('reads product names out of a transcript and ignores the surrounding words', () => {
    const hits = technologiesInTranscript(
      'The bank runs Salesforce for CRM and Snowflake for the warehouse. Okta gates access. They mentioned a sapling program.',
    );
    expect(hits.map((hit) => hit.name)).toEqual(['Salesforce', 'Snowflake', 'Okta']);
  });

  it('prefers the longer product name when both could match', () => {
    const hits = technologiesInTranscript('They licensed Salesforce Commerce Cloud last year.');
    expect(hits.map((hit) => hit.name)).toContain('Salesforce Commerce Cloud');
    expect(hits.map((hit) => hit.name)).not.toContain('Salesforce');
  });
});