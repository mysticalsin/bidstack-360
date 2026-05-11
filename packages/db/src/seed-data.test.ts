// Drift guard: every seed fixture must round-trip through the canonical Zod
// enums in @bidstack/shared. Prevents the class of bug logged in
// MISTAKES.md (TESTING category, 2026-05-10) where the Industry enum was
// narrower than the seed and integration tests caught a 500 instead.
//
// If you add a new fixture, the schema enum should already accept it OR you
// need to widen the enum and update the API contract — not just the seed.
//
// Runs in pure-Node (no Prisma client startup), so it's cheap and runs in CI
// without docker.

import { describe, expect, it } from 'vitest';

import { Industry, OpportunityStage, Sentiment, TaskStatus } from '@bidstack/shared';

import { fixtureContacts, fixtureOpps, fixtureTasks, fixtureUsers } from './seed-data.js';

describe('seed-data ↔ shared enum drift guard', () => {
  it('every fixtureOpp.industry parses against shared.Industry', () => {
    for (const o of fixtureOpps) {
      const result = Industry.safeParse(o.industry);
      expect(
        result.success,
        `fixture ${o.code} (${o.customer}) industry "${o.industry}" not in Industry enum`,
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
