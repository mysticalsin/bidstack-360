/**
 * proposals.helpers.ts — serializer and static section definitions for
 * proposal routes.
 *
 * Extracted from proposals.ts (BS-R1 file-size refactor).
 * Not part of the public API — imported only by proposals.ts.
 */
import { type z } from 'zod';

import { type Proposal, type ProposalStatus } from '@bidstack/shared';

export const DEFAULT_SECTIONS = [
  { key: 'executive_summary', title: 'Executive Summary', sortOrder: 0, required: true },
  { key: 'technical_approach', title: 'Technical Approach', sortOrder: 1, required: true },
  { key: 'pricing', title: 'Pricing & Commercial Terms', sortOrder: 2, required: true },
  { key: 'case_studies', title: 'Case Studies & References', sortOrder: 3, required: false },
  { key: 'team_bios', title: 'Team Bios', sortOrder: 4, required: false },
  { key: 'risk_matrix', title: 'Risk Matrix & Mitigation', sortOrder: 5, required: true },
] as const;

/** Shape of a Prisma proposal row used for serialization. */
export type ProposalRow = {
  id: string;
  orgId: string;
  opportunityId: string | null;
  name: string;
  status: string;
  version: number;
  ownerId: string | null;
  complianceScore: number | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Convert a Prisma proposal row to the Zod-validated wire shape.
 * Dates → ISO strings; dueDate → date-only (YYYY-MM-DD).
 */
export function serializeProposal(row: ProposalRow): z.infer<typeof Proposal> {
  return {
    id: row.id,
    orgId: row.orgId,
    opportunityId: row.opportunityId,
    name: row.name,
    status: row.status as z.infer<typeof ProposalStatus>,
    version: row.version,
    ownerId: row.ownerId,
    complianceScore: row.complianceScore,
    dueDate: row.dueDate?.toISOString().split('T')[0] ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
