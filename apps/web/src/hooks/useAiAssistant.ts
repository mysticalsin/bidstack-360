import { useMutation } from '@tanstack/react-query';

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

export function useAiFeedback() {
  return useMutation({
    mutationFn: ({ sessionId, rating, comment }: AiFeedbackInput) =>
      api<{ ok: boolean }>(`/api/ai-assistant/sessions/${sessionId}/feedback`, {
        method: 'POST',
        body: { rating, comment },
      }),
  });
}
