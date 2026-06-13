// ABC opportunity filter rules (M6) — org-level config so pre-sales can tune
// which opportunities flow in from ABC WITHOUT a code change. The Opportunity
// model has no expertise/solution fields yet; these rules are consumed by the
// future ABC sync connector at ingestion time. Empty arrays = no filtering.
import { z } from 'zod';

export const OpportunityFilterRules = z.object({
  includeExpertiseTypes: z.array(z.string().min(1).max(120)).max(100).default([]),
  includeSolutionTypes: z.array(z.string().min(1).max(120)).max(100).default([]),
  frameworkAgreementTypes: z.array(z.string().min(1).max(120)).max(100).default([]),
  // When true, only opportunities under a listed framework/agreement are kept.
  excludeNonFramework: z.boolean().default(false),
});
export type OpportunityFilterRules = z.infer<typeof OpportunityFilterRules>;

export const OpportunityFilterRulesUpdate = OpportunityFilterRules.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Update body must contain at least one field' },
);
export type OpportunityFilterRulesUpdate = z.infer<typeof OpportunityFilterRulesUpdate>;
