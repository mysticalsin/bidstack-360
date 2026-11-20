import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface MeetingPrepResult {
  sessionId: string;
  attendees: Array<{ name: string; role: string | null; company: string | null }>;
  openOpps: Array<{ id: string; title: string; stage: string }>;
  recentInteractions: string[];
  talkingPoints: string[];
  suggestedQuestions: string[];
  costMicros: number;
}

// Mirrors of the API's ai-assistant.helpers.ts result shapes — kept as local
// interfaces (not @bidstack/shared) to match how MeetingPrepResult above was
// already done for this route family.

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface EmailDraftResult {
  sessionId: string;
  drafts: EmailDraft[];
  costMicros: number;
}

export interface DealSentimentResult {
  sessionId: string;
  /** -1 (hostile) … 1 (champion). */
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  summary: string;
  riskFlags: string[];
  suggestedActions: string[];
  costMicros: number;
}

export interface AccountIntelResult {
  sessionId: string;
  /** 0–100 relationship health. */
  healthScore: number;
  summary: string;
  expansionOpportunities: string[];
  churnRisks: string[];
  costMicros: number;
}

export interface DraftEmailInput {
  intent: string;
  tone?: 'formal' | 'friendly' | 'direct';
  contactId?: string;
  dealId?: string;
}

interface AiFeedbackInput {
  sessionId: string;
  rating: number;
  comment?: string;
}

export function useMeetingPrep(calendarEventId: string) {
  return useMutation({
    mutationFn: () =>
      api<MeetingPrepResult>('/api/ai-assistant/meeting-prep', {
        method: 'POST',
        body: { calendarEventId },
      }),
  });
}

export function useDraftEmail() {
  return useMutation({
    mutationFn: (input: DraftEmailInput) =>
      api<EmailDraftResult>('/api/ai-assistant/email-draft', {
        method: 'POST',
        body: { tone: 'friendly', ...input },
      }),
  });
}

export function useDealSentiment() {
  return useMutation({
    mutationFn: (dealId: string) =>
      api<DealSentimentResult>('/api/ai-assistant/deal-sentiment', {
        method: 'POST',
        body: { dealId },
      }),
  });
}

export function useAccountIntel() {
  return useMutation({
    mutationFn: (accountId: string) =>
      api<AccountIntelResult>('/api/ai-assistant/account-intel', {
        method: 'POST',
        body: { accountId },
      }),
  });
}

// Jarvis: mirrors apps/api/src/services/jarvis/jarvis.types.ts.

export interface JarvisContextInput {
  accountId?: string;
  opportunityId?: string;
  proposalId?: string;
  rfpOpportunityId?: string;
}

export type JarvisStepStatus = 'running' | 'done' | 'error' | 'denied' | 'pending';

export interface JarvisStep {
  id: string;
  tool: string;
  kind: 'read' | 'write';
  status: JarvisStepStatus;
  summary: string;
}

export interface JarvisCitation {
  kind: 'account' | 'opportunity' | 'proposal' | 'rfp' | 'task' | 'activity';
  label: string;
  href: string;
  date?: string | null;
}

export interface JarvisPendingAction {
  id: string;
  tool: string;
  title: string;
  changes: Array<{ field: string; value: string }>;
}

export interface JarvisRun {
  runId: string;
  status: 'running' | 'done' | 'error';
  mode: 'llm' | 'demo';
  steps: JarvisStep[];
  answer: { text: string; citations: JarvisCitation[]; missing: string[] } | null;
  pendingActions: JarvisPendingAction[];
}

export interface JarvisDecisionInput {
  actionId: string;
  decision: 'confirm' | 'cancel';
}

export interface JarvisDecisionResult {
  ok: boolean;
  tool?: string;
  result?: { id?: string; proposalId?: string } | null;
  citation?: JarvisCitation | null;
}

/** Queries a confirmed Jarvis write made stale, matching the normal edit hooks. */
export function jarvisWriteQueryKeys(data: JarvisDecisionResult): QueryKey[] {
  switch (data.tool) {
    case 'opportunity.update':
      return [
        ...(data.result?.id ? [['opportunity', data.result.id]] : []),
        ['opportunities'],
        ['report:pipeline'],
      ];
    case 'proposal.section_draft':
      return [...(data.result?.proposalId ? [['proposal', data.result.proposalId]] : []), ['proposals']];
    default:
      return [['tasks']];
  }
}

export function useStartJarvisRun() {
  return useMutation({
    mutationFn: (input: { message: string; context: JarvisContextInput }) =>
      api<{ runId: string }>('/api/ai-assistant/jarvis/runs', { method: 'POST', body: input }),
  });
}

/** Polls a run until it settles; steps appear as the server records them. */
export function useJarvisRunStatus(runId: string | null) {
  return useQuery({
    queryKey: ['jarvis', 'run', runId],
    queryFn: () => api<JarvisRun>(`/api/ai-assistant/jarvis/runs/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 700 : false),
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useJarvisActionDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, decision }: JarvisDecisionInput) =>
      api<JarvisDecisionResult>(`/api/ai-assistant/jarvis/actions/${actionId}/${decision}`, {
        method: 'POST',
      }),
    onSuccess: (data, vars) => {
      if (vars.decision !== 'confirm') return;
      for (const queryKey of jarvisWriteQueryKeys(data)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useAiFeedback() {
  return useMutation({
    mutationFn: ({ sessionId, rating, comment }: AiFeedbackInput) =>
      api<{ ok: boolean }>(`/api/ai-assistant/sessions/${sessionId}/feedback`, {
        method: 'POST',
        body: { rating, comment },
      }),
  });
}
