/**
 * Page-ranged source retrieval for the compliance proposer.
 *
 * Today the compliance-fill worker hands the model a bare requirement sentence
 * and nothing else, then writes the answer it gets back onto a
 * production-visible row with no citation. This file supplies the missing half:
 * the actual document text the requirement came from, with a document name and
 * a page range, so that a proposed answer can be cited and re-verified.
 *
 * The provenance chain is the one the schema already models, walked in order
 * and never invented:
 *
 *   ComplianceMatrixRow.requirementId (unique)
 *     → Requirement.sourceChunkId        ← NULLABLE
 *       → SourceChunk (+ adjacent chunks in the same DocumentVersion)
 *         → DocumentVersion.versionNo → BidDocument.title
 *
 * `Requirement.sourceChunkId` being nullable is the whole reason this module
 * reports `assessable: false` rather than throwing or substituting something
 * plausible. A requirement with no chunk is UNAVAILABLE evidence — the Round-1
 * unknown-is-not-bad law (ADR-0004 Decision 4) — never a zero score and never
 * an invented citation.
 *
 * Every function here takes the client as an argument and touches no module
 * state, so the whole file unit-tests against a hand-written fake with no
 * database. The interfaces below are deliberately narrower than Prisma's
 * delegates; `prisma` satisfies them structurally.
 */

/** Adjacent chunks pulled either side of the anchor, for sentence-straddling clauses. */
export const NEIGHBOUR_RADIUS = 1;

export interface RetrievedChunk {
  id: string;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string | null;
  text: string;
}

export interface RetrievedRequirement {
  id: string;
  opportunityId: string | null;
  text: string;
  mandatory: boolean;
  sourceChunkId: string | null;
  documentVersionId: string | null;
}

export interface RetrievedDocument {
  documentVersionId: string;
  versionNo: number;
  title: string;
}

export interface RetrievedMatrixRow {
  id: string;
  requirementId: string;
  opportunityId: string | null;
  answerDraft: string | null;
}

export interface PageRange {
  start: number;
  end: number;
}

/**
 * Why a context could not be assessed. Each value is a fact about our data, not
 * a judgement about the requirement — none of them mean "not compliant".
 */
export type UnavailableReason =
  | 'matrix-row-not-found'
  | 'requirement-not-found'
  | 'no-source-chunk'
  | 'chunk-not-found';

export interface RequirementContext {
  requirement: RetrievedRequirement | null;
  chunk: RetrievedChunk | null;
  /** Adjacent chunks, anchor excluded, ascending by chunkIndex. */
  neighbours: RetrievedChunk[];
  document: RetrievedDocument | null;
  /** Span across the anchor and its neighbours; null when no chunk carries pages. */
  pageRange: PageRange | null;
  /** False caps the resulting fact at `assessmentStatus: UNAVAILABLE`. */
  assessable: boolean;
  unavailableReason: UnavailableReason | null;
}

// ─── Client port ────────────────────────────────────────────────────────────

export interface RetrievalClient {
  complianceMatrixRow: {
    findFirst(args: {
      where: { id: string; orgId: string; deletedAt: null };
      select: { id: true; requirementId: true; opportunityId: true; answerDraft: true };
    }): Promise<RetrievedMatrixRow | null>;
  };
  requirement: {
    findFirst(args: {
      where: { id: string; orgId: string; deletedAt: null };
      select: {
        id: true;
        opportunityId: true;
        text: true;
        mandatory: true;
        sourceChunkId: true;
        documentVersionId: true;
      };
    }): Promise<RetrievedRequirement | null>;
  };
  sourceChunk: {
    findFirst(args: {
      where: { id: string; orgId: string; deletedAt: null };
      select: {
        id: true;
        chunkIndex: true;
        pageStart: true;
        pageEnd: true;
        sectionPath: true;
        text: true;
        documentVersionId: true;
      };
    }): Promise<(RetrievedChunk & { documentVersionId: string }) | null>;
    findMany(args: {
      where: {
        orgId: string;
        documentVersionId: string;
        deletedAt: null;
        chunkIndex: { gte: number; lte: number };
        id: { not: string };
      };
      select: {
        id: true;
        chunkIndex: true;
        pageStart: true;
        pageEnd: true;
        sectionPath: true;
        text: true;
      };
      orderBy: { chunkIndex: 'asc' };
      take: number;
    }): Promise<RetrievedChunk[]>;
  };
  documentVersion: {
    findFirst(args: {
      where: { id: string; orgId: string; deletedAt: null };
      select: { id: true; versionNo: true; bidDocument: { select: { title: true } } };
    }): Promise<{ id: string; versionNo: number; bidDocument: { title: string } } | null>;
  };
}

// ─── Retrieval ──────────────────────────────────────────────────────────────

function unavailable(
  reason: UnavailableReason,
  requirement: RetrievedRequirement | null = null,
): RequirementContext {
  return {
    requirement,
    chunk: null,
    neighbours: [],
    document: null,
    pageRange: null,
    assessable: false,
    unavailableReason: reason,
  };
}

/**
 * Requirement → chunk → neighbours → document. `orgId` is in every where-clause
 * because the tenant-scope guard counts an unscoped worker query as a leak
 * (production-env.ts:88-95), not as a style problem.
 */
export async function retrieveRequirementContext(
  db: RetrievalClient,
  args: { orgId: string; requirementId: string; neighbourRadius?: number },
): Promise<RequirementContext> {
  const { orgId, requirementId } = args;
  const radius = args.neighbourRadius ?? NEIGHBOUR_RADIUS;

  const requirement = await db.requirement.findFirst({
    where: { id: requirementId, orgId, deletedAt: null },
    select: {
      id: true,
      opportunityId: true,
      text: true,
      mandatory: true,
      sourceChunkId: true,
      documentVersionId: true,
    },
  });
  if (!requirement) return unavailable('requirement-not-found');

  // The nullable link. A requirement extracted before the chunk link existed
  // has none, and that is a known state — not a retrieval failure to paper over.
  if (!requirement.sourceChunkId) return unavailable('no-source-chunk', requirement);

  const chunk = await db.sourceChunk.findFirst({
    where: { id: requirement.sourceChunkId, orgId, deletedAt: null },
    select: {
      id: true,
      chunkIndex: true,
      pageStart: true,
      pageEnd: true,
      sectionPath: true,
      text: true,
      documentVersionId: true,
    },
  });
  // A dangling link (chunk soft-deleted, or belonging to another org) is also
  // UNAVAILABLE. It is never grounds to fall back to a different chunk.
  if (!chunk) return unavailable('chunk-not-found', requirement);

  const { documentVersionId, ...anchor } = chunk;
  const neighbours = await retrieveNeighbours(db, { orgId, documentVersionId, anchor, radius });
  const document = await retrieveDocument(db, { orgId, documentVersionId });

  return {
    requirement,
    chunk: anchor,
    neighbours,
    document,
    pageRange: pageRangeOf([anchor, ...neighbours]),
    assessable: true,
    unavailableReason: null,
  };
}

/** Matrix row → its requirement → the chain above. */
export async function retrieveMatrixRowContext(
  db: RetrievalClient,
  args: { orgId: string; matrixRowId: string; neighbourRadius?: number },
): Promise<{ matrixRow: RetrievedMatrixRow | null; context: RequirementContext }> {
  const matrixRow = await db.complianceMatrixRow.findFirst({
    where: { id: args.matrixRowId, orgId: args.orgId, deletedAt: null },
    select: { id: true, requirementId: true, opportunityId: true, answerDraft: true },
  });
  if (!matrixRow) return { matrixRow: null, context: unavailable('matrix-row-not-found') };

  const context = await retrieveRequirementContext(db, {
    orgId: args.orgId,
    requirementId: matrixRow.requirementId,
    neighbourRadius: args.neighbourRadius,
  });
  return { matrixRow, context };
}

async function retrieveNeighbours(
  db: RetrievalClient,
  args: {
    orgId: string;
    documentVersionId: string;
    anchor: RetrievedChunk;
    radius: number;
  },
): Promise<RetrievedChunk[]> {
  if (args.radius <= 0) return [];
  // WHY adjacency rather than a vector search: the neighbours exist to stop a
  // clause that straddles a chunk boundary from reading as a half sentence.
  // That is a positional problem, and adjacency answers it deterministically —
  // the same context every run, which is what makes a citation re-verifiable.
  return db.sourceChunk.findMany({
    where: {
      orgId: args.orgId,
      documentVersionId: args.documentVersionId,
      deletedAt: null,
      chunkIndex: {
        gte: args.anchor.chunkIndex - args.radius,
        lte: args.anchor.chunkIndex + args.radius,
      },
      id: { not: args.anchor.id },
    },
    select: {
      id: true,
      chunkIndex: true,
      pageStart: true,
      pageEnd: true,
      sectionPath: true,
      text: true,
    },
    orderBy: { chunkIndex: 'asc' },
    take: args.radius * 2,
  });
}

async function retrieveDocument(
  db: RetrievalClient,
  args: { orgId: string; documentVersionId: string },
): Promise<RetrievedDocument | null> {
  const version = await db.documentVersion.findFirst({
    where: { id: args.documentVersionId, orgId: args.orgId, deletedAt: null },
    select: { id: true, versionNo: true, bidDocument: { select: { title: true } } },
  });
  if (!version) return null;
  return {
    documentVersionId: version.id,
    versionNo: version.versionNo,
    title: version.bidDocument.title,
  };
}

// ─── Presentation ───────────────────────────────────────────────────────────

/** Anchor first, then neighbours — the model reads the anchor as the primary source. */
export function orderedChunks(context: RequirementContext): RetrievedChunk[] {
  if (!context.chunk) return [];
  return [context.chunk, ...context.neighbours];
}

export function chunkIndexById(context: RequirementContext): Map<string, RetrievedChunk> {
  return new Map(orderedChunks(context).map((chunk) => [chunk.id, chunk]));
}

export function pageRangeOf(chunks: RetrievedChunk[]): PageRange | null {
  const pages = chunks
    .flatMap((chunk) => [chunk.pageStart, chunk.pageEnd])
    .filter((page): page is number => typeof page === 'number');
  if (pages.length === 0) return null;
  return { start: Math.min(...pages), end: Math.max(...pages) };
}

export function formatPageRange(range: PageRange | null): string {
  if (!range) return 'page unknown';
  return range.start === range.end ? `page ${range.start}` : `pages ${range.start}-${range.end}`;
}

/**
 * The source block handed to the model. Each chunk carries the id the model
 * must echo back on a citation — an id it did not receive here is rejected
 * upstream, which is what keeps a citation inside this tenant's own documents.
 */
export function formatSourceContext(context: RequirementContext): string {
  const chunks = orderedChunks(context);
  if (chunks.length === 0) return '';

  const docName = context.document
    ? `${context.document.title} (v${context.document.versionNo})`
    : 'Unnamed document';

  return chunks
    .map((chunk, position) => {
      const label = position === 0 ? 'ANCHOR' : 'NEARBY';
      const pages = formatPageRange(pageRangeOf([chunk]));
      const section = chunk.sectionPath ? `, ${chunk.sectionPath}` : '';
      return `[${label} id=${chunk.id}] ${docName}, ${pages}${section}\n${chunk.text}`;
    })
    .join('\n\n');
}
