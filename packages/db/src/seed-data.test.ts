// Drift guard: every seed fixture must round-trip through the canonical Zod
// schemas (closed enums) AND the open-ended `INDUSTRIES` UI helper list in
// @bidstack/shared. Prevents the class of bug logged in MISTAKES.md
// (TESTING category, 2026-05-10) where the Industry enum was narrower than
// the seed and integration tests caught a 500 instead.
//
// `Industry` was later widened to `z.string()` (audit P2.2) so Dust enrichment
// can add new verticals without a schema change. The drift guard now uses the
// `INDUSTRIES` UI helper list as the source of truth so dropdown options stay
// consistent with seeded values — that's where drift would actually bite the
// user (an industry on a row that the create form can't reproduce).
//
// Runs in pure-Node (no Prisma client startup), so it's cheap and runs in CI
// without docker.

import { describe, expect, it } from 'vitest';

import { INDUSTRIES, OpportunityStage, Sentiment, TaskStatus } from '@bidstack/shared';

import { fixtureContacts, fixtureOpps, fixtureTasks, fixtureUsers } from './seed-data.js';

describe('seed-data ↔ shared schema drift guard', () => {
  it('every fixtureOpp.industry appears in INDUSTRIES (UI dropdown source of truth)', () => {
    const allowed = new Set<string>(INDUSTRIES);
    for (const o of fixtureOpps) {
      expect(
        allowed.has(o.industry),
        `fixture ${o.code} (${o.customer}) industry "${o.industry}" not in INDUSTRIES — add it to packages/shared/src/schemas/opportunity.ts so the create form can reproduce it`,
      ).toBe(true);
    }
  });

  it('every fixtureOpp.stage parses against shared.OpportunityStage', () => {
    for (const o of fixtureOpps) {
      const result = OpportunityStage.safeParse(o.stage);
      expect(
        result.success,
        `fixture ${o.code} (${o.customer}) stage "${o.stage}" not in OpportunityStage enum`,
      ).toBe(true);
    }
  });

  it('every fixtureContact.sentiment parses against shared.Sentiment', () => {
    for (const c of fixtureContacts) {
      const result = Sentiment.safeParse(c.sentiment);
      expect(
        result.success,
        `fixture contact "${c.name}" sentiment "${c.sentiment}" not in Sentiment enum`,
      ).toBe(true);
    }
  });

  it('every fixtureTask.status parses against shared.TaskStatus', () => {
    for (const t of fixtureTasks) {
      const result = TaskStatus.safeParse(t.status);
      expect(
        result.success,
        `fixture task "${t.title}" status "${t.status}" not in TaskStatus enum`,
      ).toBe(true);
    }
  });

  it('every fixtureUser.email is a valid email (cheap shape check)', () => {
    // Catches typos like missing @ before they reach Prisma's runtime check.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const u of fixtureUsers) {
      expect(emailRe.test(u.email), `fixture user "${u.name}" has bad email ${u.email}`).toBe(true);
    }
  });
});
