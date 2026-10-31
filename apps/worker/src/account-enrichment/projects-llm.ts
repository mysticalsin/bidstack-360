/**
 * Optional LLM pass over rule-found potential projects. It may rewrite each
 * project's name and rationale only; ids, confidence and evidence stay as the
 * rules produced them, and it cannot add projects. Uses the org LLM first,
 * then the env LLM (the existing worker LLM service). Any failure keeps the
 * deterministic text.
 */
import type { PotentialProject } from '@bidstack/shared';

import { coerceJsonObject, completeChat, resolveLlmFromEnv, type ResolvedLlm } from '../lib/llm-provider.js';
import { resolveOrgLlm } from '../lib/org-llm.js';

export type ProjectLlm = (input: { system: string; user: string }) => Promise<string>;

const SYSTEM = [
  'You label likely projects behind a company\'s open job postings for a B2B sales team.',
  'You receive projects found by rules. For each id, return a short name (max 80 characters) and a one or two sentence rationale (max 300 characters) grounded only in the given postings.',
  'Do not invent facts, numbers, customers or technologies. Do not use em dashes. Write plain business English.',
  'Answer with JSON only: {"projects":[{"id":"...","name":"...","rationale":"..."}]}.',
].join(' ');

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\u2014\u2013]/g, ', ').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
  return s && s.length <= max ? s : null;
}

export async function relabelProjects(projects: PotentialProject[], llm: ProjectLlm | null): Promise<PotentialProject[]> {
  if (!llm || projects.length === 0) return projects;
  const payload = projects.slice(0, 12).map((p) => ({
    id: p.id,
    name: p.name,
    region: p.region,
    confidence: p.confidence,
    rationale: p.rationale,
    skills: p.skills,
    titles: p.evidence.map((e) => e.title),
  }));
  let parsed: unknown;
  try {
    parsed = JSON.parse(coerceJsonObject(await llm({ system: SYSTEM, user: JSON.stringify({ projects: payload }) })));
  } catch {
    return projects;
  }
  const rows = (parsed as { projects?: unknown }).projects;
  if (!Array.isArray(rows)) return projects;
  const byId = new Map<string, { name: string; rationale: string }>();
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    const name = clean(row.name, 80);
    const rationale = clean(row.rationale, 300);
    if (typeof row.id === 'string' && name && rationale) byId.set(row.id, { name, rationale });
  }
  return projects.map((p) => {
    const hit = byId.get(p.id);
    return hit ? { ...p, ...hit, method: 'rules+llm' as const } : p;
  });
}

/** Org LLM, then env LLM, else null (deterministic text is kept). */
export async function resolveProjectLlm(orgId: string): Promise<ProjectLlm | null> {
  let llm: ResolvedLlm | null;
  try {
    llm = (await resolveOrgLlm(orgId)) ?? resolveLlmFromEnv();
  } catch {
    llm = null;
  }
  if (!llm) return null;
  const resolved = llm;
  return ({ system, user }) => completeChat(resolved, { system, user, responseFormat: 'json_object', maxTokens: 1200, timeoutMs: 30_000 });
}
