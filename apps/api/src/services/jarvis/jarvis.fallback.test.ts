// Deterministic Jarvis planner used when no LLM is configured (demo mode).
// The demo must never be empty: each example ask maps to the tools that can
// answer it, "this" resolves to the record on screen, and a write ask turns
// into a pending tool call (never an executed one).
import { describe, expect, it } from 'vitest';

import { nextFallbackTurn, resolveDueDate } from './jarvis.fallback.js';

const NOW = new Date('2026-11-06T15:00:00Z'); // a Friday
const OPP = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

describe('resolveDueDate', () => {
  it('maps a weekday to the next occurrence, never today', () => {
    expect(resolveDueDate('for Friday', NOW)).toBe('2026-11-13');
    expect(resolveDueDate('by monday', NOW)).toBe('2026-11-09');
  });

  it('understands today and tomorrow and returns null when no date is said', () => {
    expect(resolveDueDate('tomorrow', NOW)).toBe('2026-11-07');
    expect(resolveDueDate('today', NOW)).toBe('2026-11-06');
    expect(resolveDueDate('soon', NOW)).toBeNull();
  });
});

describe('nextFallbackTurn', () => {
  it('resolves a named account, then reads its last 14 days', () => {
    const message = 'What changed on DNB Bank this week?';
    const first = nextFallbackTurn({ message, context: {}, results: [], now: NOW });
    expect(first).toEqual({ type: 'tool', tool: 'records.resolve', args: { text: message } });

    const second = nextFallbackTurn({
      message,
      context: {},
      now: NOW,
      results: [
        {
          tool: 'records.resolve',
          ok: true,
          output: { accounts: [{ id: ACCOUNT, name: 'DNB Bank' }], opportunities: [], proposals: [] },
        },
      ],
    });
    expect(second).toEqual({
      type: 'tool',
      tool: 'account.updates',
      args: { accountId: ACCOUNT, days: 14 },
    });
  });

  it('treats "this" as the account on screen', () => {
    const turn = nextFallbackTurn({
      message: 'What changed on this account?',
      context: { accountId: ACCOUNT },
      results: [],
      now: NOW,
    });
    expect(turn).toEqual({
      type: 'tool',
      tool: 'account.updates',
      args: { accountId: ACCOUNT, days: 14 },
    });
  });

  it('summarizes the RFP on screen', () => {
    const turn = nextFallbackTurn({
      message: 'Summarize this RFP',
      context: { rfpOpportunityId: OPP },
      results: [],
      now: NOW,
    });
    expect(turn).toEqual({ type: 'tool', tool: 'rfp.summary', args: { opportunityId: OPP } });
  });

  it('asks the overdue tool for overdue bids', () => {
    const turn = nextFallbackTurn({
      message: 'Which bids are overdue and who owns them?',
      context: {},
      results: [],
      now: NOW,
    });
    expect(turn).toEqual({ type: 'tool', tool: 'bids.overdue', args: {} });
  });

  it('finds the proposal for a named customer', () => {
    const turn = nextFallbackTurn({
      message: 'Where is the MAHLE proposal?',
      context: {},
      now: NOW,
      results: [
        {
          tool: 'records.resolve',
          ok: true,
          output: { accounts: [], opportunities: [{ id: OPP, name: 'MAHLE OT/IT' }], proposals: [] },
        },
      ],
    });
    expect(turn).toEqual({ type: 'tool', tool: 'proposal.status', args: { opportunityId: OPP } });
  });

  it('turns a task ask on an opportunity into a tasks.create call for next Friday', () => {
    const message = 'Create a follow-up task for Friday';
    const first = nextFallbackTurn({ message, context: { opportunityId: OPP }, results: [], now: NOW });
    expect(first).toEqual({ type: 'tool', tool: 'records.resolve', args: { text: message } });
    const turn = nextFallbackTurn({
      message,
      context: { opportunityId: OPP },
      results: [
        {
          tool: 'records.resolve',
          ok: true,
          output: { accounts: [], opportunities: [], proposals: [] },
        },
      ],
      now: NOW,
    });
    expect(turn).toMatchObject({
      type: 'tool',
      tool: 'tasks.create',
      args: { oppId: OPP, dueDate: '2026-11-13' },
    });
    if (turn.type === 'tool') expect(String(turn.args.title)).toMatch(/follow-up/i);
  });

  it('attaches a task to the opportunity the message names, not the one on screen', () => {
    const named = '33333333-3333-4333-8333-333333333333';
    const turn = nextFallbackTurn({
      message: 'Create a task for OP-2222 to send the deck',
      context: { opportunityId: OPP },
      results: [
        {
          tool: 'records.resolve',
          ok: true,
          output: { accounts: [], opportunities: [{ id: named }], proposals: [] },
        },
      ],
      now: NOW,
    });
    expect(turn).toMatchObject({ type: 'tool', tool: 'tasks.create', args: { oppId: named } });
  });

  it('uses the opportunity on screen for "this opportunity" without resolving', () => {
    const turn = nextFallbackTurn({
      message: 'Add a task on this opportunity for tomorrow',
      context: { opportunityId: OPP },
      results: [],
      now: NOW,
    });
    expect(turn).toMatchObject({ type: 'tool', tool: 'tasks.create', args: { oppId: OPP } });
  });

  it('says what is missing when a task ask has no opportunity to attach to', () => {
    const turn = nextFallbackTurn({
      message: 'Create a follow-up task for Friday',
      context: {},
      now: NOW,
      results: [
        {
          tool: 'records.resolve',
          ok: true,
          output: { accounts: [], opportunities: [], proposals: [] },
        },
      ],
    });
    expect(turn.type).toBe('answer');
    if (turn.type === 'answer') expect(turn.missing.length).toBeGreaterThan(0);
  });

  it('answers with citations once the read tool has returned', () => {
    const turn = nextFallbackTurn({
      message: 'Which bids are overdue and who owns them?',
      context: {},
      now: NOW,
      results: [
        {
          tool: 'bids.overdue',
          ok: true,
          output: {
            items: [
              {
                kind: 'opportunity',
                code: 'OP-2045',
                name: 'MAHLE OT/IT',
                dueDate: '2026-08-01',
                owner: 'Dana Lee',
              },
            ],
            citations: [
              {
                kind: 'opportunity',
                label: 'OP-2045 MAHLE OT/IT',
                href: `/opportunities/${OPP}`,
                date: '2026-08-01',
              },
            ],
          },
        },
      ],
    });
    expect(turn.type).toBe('answer');
    if (turn.type === 'answer') {
      expect(turn.text).toContain('OP-2045');
      expect(turn.text).toContain('Dana Lee');
      expect(turn.citations[0]?.href).toBe(`/opportunities/${OPP}`);
    }
  });
});
