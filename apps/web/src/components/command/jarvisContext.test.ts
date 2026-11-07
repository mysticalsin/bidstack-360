// "This" means the record on screen. The panel sends these ids as context;
// the server treats them as the default target for "this account",
// "this proposal" and "this RFP".
import { describe, expect, it } from 'vitest';

import { parseJarvisContext } from './copilotActions';

const ID = '00000000-0000-4000-8000-000000000001';

describe('parseJarvisContext', () => {
  it('reads the account cockpit', () => {
    expect(parseJarvisContext(`/accounts/${ID}`)).toEqual({ accountId: ID });
  });

  it('reads an opportunity', () => {
    expect(parseJarvisContext(`/opportunities/${ID}`)).toEqual({ opportunityId: ID });
  });

  it('reads a proposal', () => {
    expect(parseJarvisContext(`/proposals/${ID}`)).toEqual({ proposalId: ID });
  });

  it('reads the RFP pipeline, which is keyed by opportunity', () => {
    expect(parseJarvisContext(`/rfp/${ID}/pipeline`)).toEqual({ rfpOpportunityId: ID });
  });

  it('drops anything that is not a record id', () => {
    expect(parseJarvisContext('/dashboard')).toEqual({});
    expect(parseJarvisContext('/accounts/new')).toEqual({});
  });
});
