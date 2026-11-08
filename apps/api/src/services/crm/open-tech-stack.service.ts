/**
 * Open data technology stack refresh for the account page (slice 16). The
 * detector, merge and Apollo fallback live in @bidstack/db so the worker runs
 * the same code on create, import and the weekly sweep.
 */
import {
  loadOpenTechCoverage,
  openTechNetworkEnabled,
  refreshCompanyOpenTechStack,
  type ApolloFallbackDecision,
  type OpenTechApolloJob,
  type OpenTechRefreshResult,
  type PrismaClient,
} from '@bidstack/db';
import type { TechDetectDeps } from '@bidstack/shared/server';

import { enqueueApolloEnrich } from '../../queues/company-enrich-apollo.js';
import type { RouteLog } from './enrichment.service.js';

type ApolloEnqueue = (job: OpenTechApolloJob) => Promise<string | null>;

let depsOverride: TechDetectDeps | null = null;
let apolloEnqueueOverride: ApolloEnqueue | null = null;

/** Tests inject fake DNS and HTTP. Pass null to reset. */
export function __setOpenTechDetectDepsForTest(deps: TechDetectDeps | null): void {
  depsOverride = deps;
}

/** Tests capture Apollo enqueues instead of talking to Redis. Pass null to reset. */
export function __setOpenTechApolloEnqueueForTest(fn: ApolloEnqueue | null): void {
  apolloEnqueueOverride = fn;
}

export { loadOpenTechCoverage, openTechNetworkEnabled };
export type { ApolloFallbackDecision, OpenTechRefreshResult };

export function refreshOpenTechStack(input: {
  prisma: PrismaClient;
  orgId: string;
  companyName: string;
  domain: string | null;
  website: string | null;
  log: RouteLog;
  laneTimeoutMs?: number;
}): Promise<OpenTechRefreshResult> {
  return refreshCompanyOpenTechStack({
    ...input,
    deps: depsOverride,
    enqueueApollo: apolloEnqueueOverride ?? enqueueApolloEnrich,
  });
}
