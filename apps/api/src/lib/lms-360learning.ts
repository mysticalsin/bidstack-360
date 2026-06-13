// 360Learning (Mantu Academy LMS) client — Sales Toolkits live course fetch.
// Pattern: packages/dust-client (zod-validated fetch + timeout + typed result),
// kept as an api lib since only one route consumes it.
//
// Content is NEVER stored locally (brief requirement) — every request hits the
// LMS live. Credentials ride env vars LMS_360L_BASE_URL / LMS_360L_API_KEY
// (the brief's 360L_* names are digit-first and invalid as env identifiers).
//
// TODO(360L): verify the exact courses endpoint + auth header against the
// 360Learning REST docs when Mantu Academy credentials are provisioned. The
// shapes below parse defensively (passthrough + optional fields) so a richer
// payload does not break the route.
import { z } from 'zod';

import { getEnv } from '../env.js';

const LMS_TIMEOUT_MS = 8000;

const LmsCourse = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    name: z.string().default('Untitled course'),
    description: z.string().nullish(),
    tags: z.array(z.string()).default([]),
    publicUrl: z.string().nullish(),
    url: z.string().nullish(),
  })
  .passthrough();

export interface SalesToolkitCourse {
  id: string;
  title: string;
  description: string | null;
  sectorTags: string[];
  url: string | null;
}

export class LmsError extends Error {}

/** True when the 360Learning integration is enabled AND configured. */
export function lmsConfigured(): boolean {
  const env = getEnv();
  return env.LMS_360L_ENABLED === 'true' && Boolean(env.LMS_360L_BASE_URL && env.LMS_360L_API_KEY);
}

/**
 * Live course list, optionally filtered by a sector tag (case-insensitive
 * match against course tags — the same sector taxonomy the account/sector
 * views use).
 */
export async function fetchLmsCourses(sector?: string): Promise<SalesToolkitCourse[]> {
  const env = getEnv();
  if (!lmsConfigured()) throw new LmsError('LMS integration is not configured');

  const base = (env.LMS_360L_BASE_URL ?? '').replace(/\/$/, '');
  const url = new URL(`${base}/api/v2/courses`);
  url.searchParams.set('apiKey', env.LMS_360L_API_KEY ?? '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LMS_TIMEOUT_MS);
  let payload: unknown;
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new LmsError(`LMS responded ${res.status}`);
    payload = await res.json();
  } catch (err) {
    if (err instanceof LmsError) throw err;
    throw new LmsError(err instanceof Error ? `LMS unreachable: ${err.message}` : 'LMS unreachable');
  } finally {
    clearTimeout(timer);
  }

  const rows = z.array(LmsCourse).safeParse(Array.isArray(payload) ? payload : []);
  if (!rows.success) throw new LmsError('LMS returned an unexpected payload shape');

  const wanted = sector?.trim().toLowerCase();
  return rows.data
    .map((course) => ({
      id: course._id ?? course.id ?? course.name,
      title: course.name,
      description: course.description ?? null,
      sectorTags: course.tags,
      url: course.publicUrl ?? course.url ?? null,
    }))
    .filter(
      (course) =>
        !wanted || course.sectorTags.some((tag) => tag.toLowerCase().includes(wanted)),
    )
    .slice(0, 100);
}
