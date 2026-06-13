// Spotlight Ref receiving end (A5) — validated project references attached to
// an account. The consultant->manager authoring flow happens upstream in
// Spotlight Ref (ingestion is a stub until that system is reworked); BidStack
// owns the display + the pre-sales validation step.
import { z } from 'zod';

export const ProjectReferenceStatus = z.enum([
  'draft',
  'manager_review',
  'validated',
  'dispatched',
]);
export type ProjectReferenceStatus = z.infer<typeof ProjectReferenceStatus>;

export const ProjectReference = z.object({
  id: z.string().uuid(),
  accountKey: z.string().min(1),
  title: z.string().min(1).max(255),
  technicalSummary: z.string().max(8000).nullable(),
  businessSummary: z.string().max(8000).nullable(),
  status: ProjectReferenceStatus,
  sourceSystem: z.string().min(1),
  validatedById: z.string().uuid().nullable(),
  dispatchedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectReference = z.infer<typeof ProjectReference>;

export const ProjectReferenceList = z.object({
  items: z.array(ProjectReference),
});
export type ProjectReferenceList = z.infer<typeof ProjectReferenceList>;
