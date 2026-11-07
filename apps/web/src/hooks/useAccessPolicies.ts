import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AccessPolicyResource, AccessPolicyRule } from '@bidstack/shared';

import { api } from '@/lib/api';

export type AccessPolicyStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'superseded';

export interface AccessPolicyVersion {
  id: string;
  name: string;
  status: AccessPolicyStatus;
  version: number | null;
  rules: AccessPolicyRule[];
  createdById: string;
  createdByName: string | null;
  submittedAt: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  publishedAt: string | null;
  rollbackOfId: string | null;
  createdAt: string;
}

export interface AccessPolicyList {
  items: AccessPolicyVersion[];
  published: AccessPolicyVersion | null;
  nextVersion: number;
  enforcement: boolean;
  viewerId: string;
}

export interface AccessPolicySimulationSide {
  count: number;
  users: Array<{ userId: string; name: string; count: number }>;
  examples: Array<{
    at: string;
    userId: string;
    userName: string;
    action: string;
    resource: AccessPolicyResource;
    targetId: string | null;
    ruleId: string | null;
  }>;
}

export interface AccessPolicySimulation {
  window: { from: string; to: string };
  evaluated: number;
  baselineVersion: number | null;
  gained: AccessPolicySimulationSide;
  lost: AccessPolicySimulationSide;
  byDay: Array<{ day: string; gained: number; lost: number }>;
}

const KEY = ['access-policies'] as const;
const BASE = '/api/v1/access-policies';

export function useAccessPolicies() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api<AccessPolicyList>(BASE, { signal }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useSaveAccessPolicy() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { id?: string; name: string; rules: AccessPolicyRule[] }) =>
      input.id
        ? api<AccessPolicyVersion>(`${BASE}/${input.id}`, {
            method: 'PATCH',
            body: { name: input.name, rules: input.rules },
          })
        : api<AccessPolicyVersion>(BASE, {
            method: 'POST',
            body: { name: input.name, rules: input.rules },
          }),
    onSuccess: invalidate,
  });
}

export type AccessPolicyTransition = 'submit' | 'approve' | 'reject' | 'publish' | 'rollback';

export function useAccessPolicyTransition() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: AccessPolicyTransition; note?: string }) =>
      api<AccessPolicyVersion>(`${BASE}/${id}/${action}`, {
        method: 'POST',
        body: action === 'approve' || action === 'reject' ? (note ? { note } : {}) : {},
      }),
    onSuccess: invalidate,
  });
}

export function useSimulateAccessPolicy() {
  return useMutation({
    mutationFn: (rules: AccessPolicyRule[]) =>
      api<AccessPolicySimulation>(`${BASE}/simulate`, { method: 'POST', body: { rules } }),
  });
}
