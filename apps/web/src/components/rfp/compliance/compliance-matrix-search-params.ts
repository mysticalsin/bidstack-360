// URL state for the Compliance Matrix — the fourth bid surface.
//
// Colocated with the component instead of living under pages/: the matrix is
// not a page. It is mounted inside RfpPipelinePage at the `awaiting_approval`
// stage (RfpPipelinePage.tsx:175) and owns its own query keys there, so the
// declaration belongs next to its only consumer.
//
// Keys, per ROUND2-ULTRAPLAN's "facets: status/section/mandatory":
//   ?status=      compliant | partial | non_compliant | pending   (the tab)
//   ?section=     a requirement type — see the deviation note below
//   ?mandatory=   yes | no
//   ?sort= ?dir= ?page= ?pageSize= ?q= ?expand=   — from createListSearchParams
//
// DEVIATION, STATED LOUDLY: the plan says "section". There is no `section`
// column anywhere in the schema — `Requirement` carries `requirementType`
// (schema.prisma:1649) and nothing else that groups requirements. The facet is
// therefore keyed `section` in the URL (the reviewer-facing word) and backed by
// `requirementType` in the data. When a real section/lot column lands, only the
// mapping in ComplianceMatrix changes; the URL contract is already right.
//
// `status` is safe to own here: RfpPipelinePage reads its identity from the
// path (`/rfp/:id/pipeline`) and declares no query params of its own, and every
// write goes through nuqs, which merges rather than replaces
// (docs/design-system/url-param-audit.md §4).

import { createListSearchParams } from '@/lib/table/list-search-params';

export const COMPLIANCE_STATUSES = ['compliant', 'partial', 'non_compliant', 'pending'] as const;
export type ComplianceStatusSegment = (typeof COMPLIANCE_STATUSES)[number];

export const MANDATORY_SEGMENTS = ['yes', 'no'] as const;

/** Column ids the matrix can sort by. `''` = the API's own order (createdAt asc). */
export const COMPLIANCE_SORT_IDS = ['requirement', 'status', 'confidence'] as const;
export type ComplianceSortId = (typeof COMPLIANCE_SORT_IDS)[number];

export const COMPLIANCE_PAGE_SIZE = 25;

export const complianceMatrixSearchParams = createListSearchParams<
  'status',
  'section' | 'mandatory'
>({
  tabId: 'status',
  facetIds: ['section', 'mandatory'],
  // The whole matrix arrives in one response (the API takes 500), so paging is
  // client-side. 25 is not cosmetic: it is the hard bound on how many BidFact
  // queries one screen can fan out (see useBidFacts.ts).
  pageSize: COMPLIANCE_PAGE_SIZE,
  defaultSort: '',
  defaultDir: 'asc',
});
