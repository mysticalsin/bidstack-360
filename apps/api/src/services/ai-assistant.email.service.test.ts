/**
 * ai-assistant.email.service.test.ts — draftEmail's direct-LLM fallback.
 *
 * WHY this test matters: when Dust is unconfigured, draftEmail used to drop
 * straight to a canned static stub. It must now try completeChatOrNull (the
 * free, keyless OmniRoute gateway) first and only fall through to the stub
 * if that also returns null. This test fails the moment that ordering
 * regresses — e.g. if someone reintroduces the stub before the LLM call, or
 * stops threading the LLM's output into the parsed drafts.
 */
import type { Logger as PinoLogger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildDustClient: vi.fn(),
  resolveAgentId: vi.fn(),
  checkDailyCap: vi.fn(),
  completeChatOrNull: vi.fn(),
  estimateCost: vi.fn(),
  persistSession: vi.fn(),
  recordCost: vi.fn(),
  buildEmailDraftContext: vi.fn(),
}));

vi.mock('./ai-assistant.helpers.js', () => ({
  buildDustClient: mocks.buildDustClient,
  resolveAgentId: mocks.resolveAgentId,
  checkDailyCap: mocks.checkDailyCap,
  completeChatOrNull: mocks.completeChatOrNull,
  estimateCost: mocks.estimateCost,
  persistSession: mocks.persistSession,
  recordCost: mocks.recordCost,
}));

vi.mock('./ai-assistant.context.js', () => ({
  buildEmailDraftContext: mocks.buildEmailDraftContext,
}));

const { draftEmail } = await import('./ai-assistant.email.service.js');

const log = { child: vi.fn() } as unknown as PinoLogger;
const childLog = { warn: vi.fn() } as unknown as PinoLogger;

const input = {
  orgId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  contactId: 'contact-1',
  tone: 'friendly' as const,
  intent: 'follow up on the proposal',
};

beforeEach(() => {
  vi.clearAllMocks();
  (log.child as ReturnType<typeof vi.fn>).mockReturnValue(childLog);
  mocks.checkDailyCap.mockResolvedValue({ allowed: true });
  mocks.buildEmailDraftContext.mockResolvedValue({ contextStr: '\nContact: Jane Doe' });
  // Dust unconfigured — the condition under which the direct-LLM fallback
  // must be attempted before the stub.
  mocks.buildDustClient.mockResolvedValue({ client: null, creds: null });
  mocks.resolveAgentId.mockReturnValue(undefined);
  mocks.estimateCost.mockReturnValue(100n);
  mocks.persistSession.mockResolvedValue('session-1');
  mocks.recordCost.mockResolvedValue(undefined);
});

describe('draftEmail — direct LLM fallback', () => {
  it('uses the OmniRoute completion instead of the static stub when Dust is unconfigured', async () => {
    const llmDrafts = [
      { subject: 'Following up on our proposal', body: 'Hi Jane, checking in on the proposal.' },
      { subject: 'Re: proposal follow-up', body: 'Just circling back on this.' },
      { subject: 'Proposal — next steps', body: 'Let me know if you have questions.' },
    ];
    mocks.completeChatOrNull.mockResolvedValue(JSON.stringify(llmDrafts));

    const result = await draftEmail(input, log);

    // The stub's fixed "[Draft N]" subjects are never produced when the
    // direct LLM answers — proves the stub path wasn't taken.
    expect(result.drafts[0].subject).toBe('Following up on our proposal');
    expect(result.drafts).toEqual(llmDrafts);

    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      input.orgId,
      expect.objectContaining({
        user: expect.stringContaining(input.intent),
        responseFormat: 'json_object',
      }),
      childLog,
    );
    expect(mocks.persistSession).toHaveBeenCalledWith(
      expect.objectContaining({ response: JSON.stringify(llmDrafts) }),
    );
  });

  it('falls through to the static stub when the direct LLM also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await draftEmail(input, log);

    // Stub subjects are the "[Draft N] <intent>" pattern — this is the
    // last-resort path, only reached when both Dust and the LLM fail.
    expect(result.drafts[0].subject).toBe(`[Draft 1] ${input.intent}`);
    expect(mocks.completeChatOrNull).toHaveBeenCalled();
  });
});
