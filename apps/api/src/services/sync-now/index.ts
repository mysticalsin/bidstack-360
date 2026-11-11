// "Sync now": one start / poll / overview contract over every pull source, so
// the web control is the same component for Dust and HubSpot.

import type { SyncOverview, SyncRun, SyncSource } from '@bidstack/shared';

import { closeDustPollQueue } from '../../queues/dust-poll.js';
import { getDustSyncOverview, getDustSyncRun, startDustSync } from './dust.js';
import type { StartSyncInput } from './errors.js';
import { closeHubspotSyncQueue, getHubspotSyncOverview, getHubspotSyncRun, startHubspotSync } from './hubspot.js';

export { SyncNotFoundError, SyncUnavailableError, type StartSyncInput } from './errors.js';

export const SYNC_SOURCES = ['dust', 'hubspot'] as const satisfies readonly SyncSource[];

export function startSyncRun(source: SyncSource, input: StartSyncInput): Promise<SyncRun> {
  return source === 'dust' ? startDustSync(input) : startHubspotSync(input);
}

export function getSyncRun(source: SyncSource, orgId: string, runId: string): Promise<SyncRun> {
  return source === 'dust' ? getDustSyncRun(orgId, runId) : getHubspotSyncRun(orgId, runId);
}

export function getSyncOverview(source: SyncSource, orgId: string): Promise<SyncOverview> {
  return source === 'dust' ? getDustSyncOverview(orgId) : getHubspotSyncOverview(orgId);
}

/** Closes the queues Sync now opens on first use, and their Redis connections. */
export async function closeSyncNowQueues(): Promise<void> {
  await Promise.all([closeDustPollQueue(), closeHubspotSyncQueue()]);
}
