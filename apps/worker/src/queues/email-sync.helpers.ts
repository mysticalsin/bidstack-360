/**
 * email-sync.helpers.ts — job schema and the Graph token accessor.
 *
 * Extracted from email-sync.ts (BS-R1 file-size refactor).
 * Used by email-sync.pull.ts, email-sync.subscriptions.ts, and email-sync.ts.
 */
import type pino from 'pino';
import { z } from 'zod';

import { getWorkspaceAccessToken, type WorkspaceTokenRow } from '../lib/workspace-token.js';

// ─── Job data schema ─────────────────────────────────────────────────────────

export const PullJobData = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  integrationTokenId: z.string().uuid(),
});

// ─── Token helpers ────────────────────────────────────────────────────────────

/** Live Graph access token; refresh, rotation and revocation live in workspace-token. */
export async function getAccessToken(row: WorkspaceTokenRow, log: pino.Logger): Promise<string> {
  return getWorkspaceAccessToken(row, log);
}
