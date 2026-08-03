// Database persistence for bid-workspace extraction artifacts.
// Isolated here so the main processor stays focused on orchestration
// and this module can be tested or retried independently.

import { prisma } from '@bidstack/db';

import { buildSourceChunks, extractRequirementCandidates } from './document-extract-analysis.js';

export async function writeBidWorkspaceArtifacts({
  orgId,
  opportunityId,
  bidDocumentId,
  documentVersionId,
  text,
  dustRunId,
}: {
  orgId: string;
  opportunityId: string;
  bidDocumentId: string;
  documentVersionId: string;
  text: string;
  dustRunId: string | null;
}): Promise<void> {
  const chunks = buildSourceChunks(text);
  const requirements = extractRequirementCandidates(chunks);

  await prisma.$transaction(async (tx) => {
    const version = await tx.documentVersion.findFirst({
      where: { id: documentVersionId, orgId, bidDocumentId, deletedAt: null },
      select: { id: true },
    });
    if (!version) {
      throw new Error('Bid document extraction job does not match an active tenant-scoped version');
    }

    const humanTouchedRequirements = await tx.requirement.count({
      where: {
        orgId,
        documentVersionId,
        deletedAt: null,
        status: { not: 'suggested' },
      },
    });

    if (humanTouchedRequirements === 0) {
      await tx.complianceMatrixRow.deleteMany({
        where: {
          orgId,
          requirement: { documentVersionId, status: 'suggested' },
        },
      });
      await tx.requirement.deleteMany({
        where: { orgId, documentVersionId, status: 'suggested' },
      });
      await tx.sourceChunk.deleteMany({ where: { orgId, documentVersionId } });

      const createdChunks = new Map<number, string>();
      for (const chunk of chunks) {
        const row = await tx.sourceChunk.create({
          data: {
            orgId,
            bidDocumentId,
            documentVersionId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            hash: chunk.hash,
            locator: { chunkIndex: chunk.chunkIndex },
          },
          select: { id: true, chunkIndex: true },
        });
        createdChunks.set(row.chunkIndex, row.id);
      }

      for (const req of requirements) {
        const sourceChunkId = createdChunks.get(req.sourceChunkIndex) ?? null;
        const created = await tx.requirement.create({
          data: {
            orgId,
            opportunityId,
            bidDocumentId,
            documentVersionId,
            sourceChunkId,
            externalRef: req.externalRef,
            text: req.text,
            requirementType: req.requirementType,
            mandatory: req.mandatory,
            priority: req.priority,
            confidenceBps: req.confidenceBps,
            // Extraction (Dust or deterministic) always produced this
            // confidence, so the row is ASSESSED — not the PENDING default.
            assessmentStatus: 'ASSESSED' as const,
            metadata: {
              extractionManaged: true,
              source: dustRunId ? 'dust_document_extract' : 'deterministic_document_extract',
            },
          },
          select: { id: true, priority: true },
        });
        const citation = [
          {
            bidDocumentId,
            documentVersionId,
            sourceChunkId,
            chunkIndex: req.sourceChunkIndex,
            text: req.text.slice(0, 500),
          },
        ];
        await tx.complianceMatrixRow.create({
          data: {
            orgId,
            opportunityId,
            requirementId: created.id,
            risk: created.priority,
            citations: citation,
            evidence: citation,
          },
        });
      }

      if (requirements.length === 0) {
        await tx.reviewIssue.create({
          data: {
            orgId,
            opportunityId,
            sourceChunkId: null,
            category: 'extraction',
            severity: 'medium',
            title: 'No explicit requirements detected',
            description:
              'The document was parsed, but no requirement-like statements were detected. Review the source manually before moving this bid forward.',
            recommendation:
              'Assign a presales reviewer to inspect the document and add requirements manually.',
          },
        });
      }
    }

    await tx.documentVersion.update({
      where: { id: documentVersionId },
      data: {
        extractedText: text,
        extractionStatus: 'succeeded',
        ocrStatus: 'succeeded',
        layoutJson: {
          chunkCount: chunks.length,
          requirementCount: requirements.length,
        },
        metadata: {
          extractionManaged: true,
          dustRunId,
          skippedRewriteBecauseHumanTouched: humanTouchedRequirements > 0,
        },
      },
    });
    await tx.bidDocument.updateMany({
      where: { id: bidDocumentId, orgId, deletedAt: null },
      data: { status: 'ready' },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId: null,
        action: 'bid_document.extracted',
        targetType: 'bid_document',
        targetId: bidDocumentId,
        diff: {
          opportunityId,
          documentVersionId,
          sourceChunks: chunks.length,
          requirements: requirements.length,
          dustRunId,
        },
      },
    });
  });
}
