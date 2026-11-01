import { describe, expect, it } from 'vitest';

import { churnKindForNpsDetractor, featureRequestChurnKind } from './churn-detection.service.js';

describe('churn signal kinds', () => {
  it('does not label an old open case as an unresolved feature request', () => {
    // WHY: ServiceCase has no feature-request type. The detector counted every
    // case open for 60 days and stored FEATURE_REQUEST_UNRESOLVED.
    expect(featureRequestChurnKind()).toBeNull();
  });

  it('does not record an NPS detractor as a usage drop', () => {
    expect(churnKindForNpsDetractor()).toBeNull();
  });
});
