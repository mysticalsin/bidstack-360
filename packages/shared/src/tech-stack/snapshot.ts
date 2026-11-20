/**
 * Stored open data technology snapshot (slice 16): what each lane found, when,
 * and how it maps onto the technical stack categories the account page shows.
 * Lives in CompanyEnrichment.providerMetadata.openTechStack; no schema change.
 */
import { z } from 'zod';

import {
  OpenTechLane,
  TechnicalStackCoverageLane,
  TechnicalStackEvidence,
  type TechnicalStackCategory,
  type TechnicalStackCoverage,
  type TechnicalStackItemType,
} from '../schemas/crm.base.js';

import type { OpenTechDetection } from './lanes.js';

export const OPEN_TECH_LANES = OpenTechLane.options;

export const OPEN_TECH_LANE_LABELS: Record<OpenTechLane, string> = {
  dns: 'DNS',
  ct: 'Cert',
  web: 'Website',
  jobs: 'Jobs',
  github: 'GitHub',
};

/** Apollo runs only when open lanes find fewer technologies than this. */
export const APOLLO_FALLBACK_THRESHOLD = 5;

export const OpenTechItem = z.object({
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  lane: OpenTechLane,
  source: z.string().min(1).max(60),
  confidence: z.number().min(0).max(1),
  evidence: TechnicalStackEvidence,
});
export type OpenTechItem = z.infer<typeof OpenTechItem>;

export const OpenTechStackSnapshot = z.object({
  version: z.literal(1),
  checkedAt: z.string().datetime(),
  sample: z.boolean().default(false),
  items: z.array(OpenTechItem).max(400),
  lanes: z.array(TechnicalStackCoverageLane),
  apolloFallback: z.enum(['queued', 'not_needed', 'not_configured', 'unavailable']).nullable().default(null),
});
export type OpenTechStackSnapshot = z.infer<typeof OpenTechStackSnapshot>;

/** The result of one detector run, before it is merged with what was stored. */
export interface OpenTechRun {
  checkedAt: string;
  items: OpenTechDetection[];
  lanes: TechnicalStackCoverageLane[];
}

export function parseOpenTechSnapshot(value: unknown): OpenTechStackSnapshot | null {
  const parsed = OpenTechStackSnapshot.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Merge a run into the stored snapshot. A lane that ran (found or empty)
 * replaces its own items; a lane that failed or was skipped keeps the items
 * it found before, so an outage never erases earlier evidence.
 */
export function mergeOpenTechSnapshot(prev: OpenTechStackSnapshot | null, run: OpenTechRun): OpenTechStackSnapshot {
  const ran = new Set(run.lanes.filter((l) => l.status === 'found' || l.status === 'empty').map((l) => l.lane));
  const kept = (prev?.items ?? []).filter((item) => !ran.has(item.lane));
  const fresh = run.items.filter((item) => ran.has(item.lane)).map((item) => OpenTechItem.parse(item));
  const items = [...kept, ...fresh].slice(0, 400);
  const prevLanes = new Map((prev?.lanes ?? []).map((l) => [l.lane, l]));
  const lanes = OPEN_TECH_LANES.map((lane) => {
    const now = run.lanes.find((l) => l.lane === lane);
    const count = items.filter((i) => i.lane === lane).length;
    if (now) return { ...now, count };
    const before = prevLanes.get(lane);
    return before ? { ...before, count } : { lane, status: 'skipped' as const, count, detail: null, checkedAt: null };
  });
  return { version: 1, checkedAt: run.checkedAt, sample: false, items, lanes, apolloFallback: prev?.apolloFallback ?? null };
}

/** Distinct technologies across lanes. */
export function openTechItemCount(snapshot: OpenTechStackSnapshot | null): number {
  return new Set((snapshot?.items ?? []).map((i) => i.name.toLowerCase())).size;
}

export function needsApolloFallback(openItems: number, threshold = APOLLO_FALLBACK_THRESHOLD): boolean {
  return openItems < threshold;
}

/**
 * Group stored items into stack categories. A technology seen by several
 * lanes becomes one item: its confidence combines the lanes (each lane is
 * independent evidence) and the strongest lane names the source.
 */
export function openTechStackCategories(snapshot: OpenTechStackSnapshot | null): TechnicalStackCategory[] {
  if (!snapshot) return [];
  const byName = new Map<string, OpenTechItem[]>();
  for (const item of snapshot.items) {
    const key = item.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }
  const categories = new Map<string, TechnicalStackItemType[]>();
  for (const group of byName.values()) {
    const best = [...group].sort((a, b) => b.confidence - a.confidence)[0]!;
    const combined = Math.min(0.99, 1 - group.reduce((acc, i) => acc * (1 - i.confidence), 1));
    const others = [...new Set(group.filter((i) => i.lane !== best.lane).map((i) => OPEN_TECH_LANE_LABELS[i.lane]))];
    const record = others.length
      ? `${best.evidence.record ?? ''}${best.evidence.record ? '. ' : ''}Also seen in ${others.join(', ')}`.slice(0, 500)
      : best.evidence.record;
    const item: TechnicalStackItemType = {
      name: best.name,
      source: best.source,
      confidence: Number(combined.toFixed(2)),
      evidence: { ...best.evidence, record },
      ...(snapshot.sample ? { sample: true } : {}),
    };
    categories.set(best.category, [...(categories.get(best.category) ?? []), item]);
  }
  return [...categories.entries()].map(([label, items]) => ({
    label,
    items: items.sort((a, b) => b.confidence - a.confidence),
  }));
}

/** Coverage for the account page: every lane, what it found, and the Apollo decision. */
export function coverageFromSnapshot(snapshot: OpenTechStackSnapshot | null, threshold = APOLLO_FALLBACK_THRESHOLD): TechnicalStackCoverage | null {
  if (!snapshot) return null;
  return {
    checkedAt: snapshot.checkedAt,
    lanes: snapshot.lanes,
    openItems: openTechItemCount(snapshot),
    apolloFallback: snapshot.apolloFallback,
    apolloThreshold: threshold,
    sample: snapshot.sample,
  };
}

/** Short source chip text for a stack item source. Plain words, no vendor jargon. */
export function techSourceLabel(source: string): string {
  const s = source.toLowerCase();
  const lane = /open_data:(dns|ct|web|jobs|github)/.exec(s)?.[1] as OpenTechLane | undefined;
  if (s.startsWith('manual:accepted:')) return lane ? OPEN_TECH_LANE_LABELS[lane] : techSourceLabel(s.slice('manual:accepted:'.length));
  if (lane) return OPEN_TECH_LANE_LABELS[lane];
  if (s.includes('manual')) return 'Manual';
  if (s.includes('meeting')) return 'Meeting notes';
  if (s.includes('apollo')) return 'Apollo';
  if (s.includes('seamless')) return 'Seamless';
  if (s.includes('tech_stack_mcp')) return 'Tech intel';
  if (s.includes('open_data') || s.includes('wikidata')) return 'Open data';
  return 'Other';
}
