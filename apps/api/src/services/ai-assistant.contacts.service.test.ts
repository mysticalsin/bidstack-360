/**
 * ai-assistant.contacts.service.test.ts — prepMeeting + enrichContact vs.
 * the direct-LLM (OmniRoute) fallback.
 *
 * WHY these tests matter: both functions used to drop straight to a static
 * stub the instant Dust was unconfigured. They now try completeChatOrNull
 * (the free, keyless OmniRoute gateway) first. A test that only checks
 * "responseText is non-empty" can't fail when that ordering regresses —
 * the stub is also non-empty JSON. So each test asserts the RETURNED VALUE
 * matches the canned completion's content, which is only possible if the
 * direct-LLM branch actually ran before the stub branch.
 */
import type { Logger as PinoLogger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkDailyCap: vi.fn(),
  buildDustClient: vi.fn(),
  resolveAgentId: vi.fn(),
  completeChatOrNull: vi.fn(),
  persistSession: vi.fn(),
  recordCost: vi.fn(),
  buildMeetingContext: vi.fn(),
  buildEnrichContext: vi.fn(),
}));

// Mock the whole helpers surface: contacts.service.ts calls these directly,
// and helpers.ts itself pulls in prisma/redis at module scope which we don't
// want touched by a unit test (mirrors ai-assistant.helpers.test.ts's own
// isolation of its module).
vi.mock('./ai-assistant.helpers.js', () => ({
  checkDailyCap: mocks.checkDailyCap,
  buildDustClient: mocks.buildDustClient,
  resolveAgentId: mocks.resolveAgentId,
  completeChatOrNull: mocks.completeChatOrNull,
  estimateCost: (input: number, output: number) => BigInt(input) * 5n + BigInt(output) * 15n,
  persistSession: mocks.persistSession,
  recordCost: mocks.recordCost,
}));

vi.mock('./ai-assistant.context.js', () => ({
  buildMeetingContext: mocks.buildMeetingContext,
  buildEnrichContext: mocks.buildEnrichContext,
}));

const { prepMeeting, enrichContact } = await import('./ai-assistant.contacts.service.js');

const orgId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const log = { child: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;

beforeEach(() => {
  vi.clearAllMocks();
  (log.child as ReturnType<typeof vi.fn>).mockReturnValue(log);
  mocks.checkDailyCap.mockResolvedValue({ allowed: true });
  // Dust unconfigured: buildDustClient returns a null client, exactly the
  // condition under which the direct-LLM fallback must be attempted.
  mocks.buildDustClient.mockResolvedValue({ client: null, creds: null });
  mocks.resolveAgentId.mockReturnValue(undefined);
  mocks.persistSession.mockResolvedValue('session-id');
  mocks.recordCost.mockResolvedValue(undefined);
});

describe('prepMeeting — direct-LLM fallback before stub', () => {
  beforeEach(() => {
    mocks.buildMeetingContext.mockResolvedValue({
      event: { id: 'evt-1', subject: 'QBR', startAt: new Date('2026-08-10T10:00:00Z') },
      safeAttendees: [{ name: 'Jane Doe', role: 'CTO', company: 'Acme' }],
      openOpps: [{ id: 'opp-1', title: 'Acme Renewal', stage: 'negotiation' }],
      recentInteractions: ['call: intro'],
      actSummary: 'call: intro',
    });
  });

  it('uses the OmniRoute completion instead of the static stub when Dust is unconfigured', async () => {
    mocks.completeChatOrNull.mockResolvedValue(
      JSON.stringify({
        talkingPoints: ['Discuss renewal pricing from OmniRoute'],
        suggestedQuestions: ['What budget cycle governs this renewal?'],
      }),
    );

    const result = await prepMeeting({ orgId, userId, calendarEventId: 'evt-1' }, log);

    // Content proves the direct-LLM completion was used, not the hardcoded
    // stub strings ("Confirm next steps and timeline", etc.).
    expect(result.talkingPoints).toEqual(['Discuss renewal pricing from OmniRoute']);
    expect(result.suggestedQuestions).toEqual(['What budget cycle governs this renewal?']);

    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ responseFormat: 'json_object' }),
      log,
    );
    // The persisted response is the OmniRoute completion, not the stub JSON.
    const persistArg = mocks.persistSession.mock.calls[0]?.[0] as { response: string };
    expect(persistArg.response).toContain('OmniRoute');
  });

  it('falls through to the static stub when completeChatOrNull also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await prepMeeting({ orgId, userId, calendarEventId: 'evt-1' }, log);

    expect(result.talkingPoints).toContain('Confirm next steps and timeline');
  });
});

describe('enrichContact — direct-LLM fallback before stub', () => {
  beforeEach(() => {
    mocks.buildEnrichContext.mockResolvedValue({
      contact: { id: 'c-1', name: 'Jane Doe', customer: 'Acme', role: null },
      safe: { id: 'c-1', name: 'Jane Doe', email: 'jane@acme.com', phone: null, role: null },
      emailDomain: 'acme.com',
    });
  });

  it('uses the OmniRoute completion instead of the static stub when Dust is unconfigured', async () => {
    mocks.completeChatOrNull.mockResolvedValue(
      JSON.stringify({
        jobTitle: 'VP Engineering',
        company: 'Acme Corp',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        seniority: 'VP',
      }),
    );

    const result = await enrichContact({ orgId, userId, contactId: 'c-1' }, log);

    // These values only exist in the canned completion, never in the stub
    // (the stub's linkedinUrl is derived from emailDomain, not this literal).
    expect(result.jobTitle).toBe('VP Engineering');
    expect(result.linkedinUrl).toBe('https://linkedin.com/in/janedoe');
    expect(result.seniority).toBe('VP');
    expect(result.source).toBe('domain-inference');

    expect(mocks.completeChatOrNull).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({ responseFormat: 'json_object' }),
      log,
    );
  });

  it('falls through to the static stub when completeChatOrNull also returns null', async () => {
    mocks.completeChatOrNull.mockResolvedValue(null);

    const result = await enrichContact({ orgId, userId, contactId: 'c-1' }, log);

    expect(result.linkedinUrl).toBe('https://linkedin.com/company/acme');
    expect(result.source).toBe('none');
  });
});
