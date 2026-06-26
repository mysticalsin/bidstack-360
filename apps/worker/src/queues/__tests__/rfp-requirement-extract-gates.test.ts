import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  ensureExtractedText: vi.fn(),
  markOrchestrationFailed: vi.fn(),
  isDocumentAiSafe: vi.fn(),
}));

vi.mock('@bidstack/db', () => ({ prisma: {} }));
vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { promptLibrary: 'governance' },
  checkSerumPromptLibraryRuntimePolicy: vi.fn(),
}));
vi.mock('@bidstack/shared', () => ({
  RFP_STORY_MATCH: { name: 'rfp.story_match' },
  rolePreambleForKey: () => 'requirements analyst',
}));
vi.mock('../rfp-requirement-extract.helpers.js', () => ({
  JobData: z.object({
    orgId: z.string().uuid(),
    rfpRequestId: z.string(),
    documentVersionId: z.string().uuid(),
    orchestrationId: z.string().uuid(),
    chunkIndex: z.number().int().min(0).default(0),
    totalChunks: z.number().int().min(1).default(1),
  }),
  ExtractedRequirement: z.object({}),
  DustExtractionResponse: z.object({ requirements: z.array(z.object({})) }),
  fallbackExtract: vi.fn(),
  ensureExtractedText: mocks.ensureExtractedText,
  updateOrchestrationPhase: vi.fn(),
  markOrchestrationFailed: mocks.markOrchestrationFailed,
  isDocumentAiSafe: mocks.isDocumentAiSafe,
}));
vi.mock('../lib/prompt-safety.js', () => ({ buildAgentUserMessage: vi.fn() }));
vi.mock('../lib/ai-audit-worker.js', () => ({ logAiInvocation: vi.fn() }));
vi.mock('../lib/dust-credentials.js', () => ({
  getOrgDust: vi.fn(),
  resolveAgentId: vi.fn(),
}));
vi.mock('../lib/llm-provider.js', () => ({
  resolveLlmFromEnv: vi.fn(),
  completeChat: vi.fn(),
  coerceJsonObject: vi.fn(),
}));

import { processJob } from '../rfp-requirement-extract.processor.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const documentVersionId = '22222222-2222-4222-8222-222222222222';
const orchestrationId = '33333333-3333-4333-8333-333333333333';

describe('RFP requirement extraction confidentiality gates', () => {
  it('blocks NDA-D documents before any source extraction can run', async () => {
    mocks.isDocumentAiSafe.mockResolvedValue(false);

    await processJob(
      {
        id: 'job-1',
        data: {
          orgId,
          rfpRequestId: 'rfp-1',
          documentVersionId,
          orchestrationId,
          chunkIndex: 0,
          totalChunks: 1,
        },
      } as never,
      { warn: vi.fn(), info: vi.fn() } as never,
      {} as never,
      {} as never,
      { logTrace: vi.fn() } as never,
    );

    expect(mocks.isDocumentAiSafe).toHaveBeenCalledWith(documentVersionId, orgId);
    expect(mocks.ensureExtractedText).not.toHaveBeenCalled();
    expect(mocks.markOrchestrationFailed).toHaveBeenCalledWith(
      orchestrationId,
      orgId,
      'requirement_extract',
      'NDA-D gate',
    );
  });
});
