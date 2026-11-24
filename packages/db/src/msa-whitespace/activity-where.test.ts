import { describe, expect, it } from 'vitest';

import { accountActivityOpportunityWhere } from './load';

describe('accountActivityOpportunityWhere', () => {
  it('drops a live lost stage and keeps a won deal in current activity', () => {
    // WHY: agreement leverage treated a custom lost pursuit as current activity.
    // A won deal still counts. A drafted lead stays out only while it is a lead.
    const where = accountActivityOpportunityWhere('org-1', ['co-1'], ['draft-1']);
    expect(where).toEqual({
      orgId: 'org-1',
      companyId: { in: ['co-1'] },
      deletedAt: null,
      AND: [
        {
          NOT: {
            OR: [
              { stage: 'closed_lost' },
              { pipelineStage: { is: { deletedAt: null, isLost: true } } },
            ],
          },
        },
        { NOT: { id: { in: ['draft-1'] }, stage: 's1_lead' } },
      ],
    });
  });
});
