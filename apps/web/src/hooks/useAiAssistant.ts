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

export function useAiFeedback() {
  return useMutation({
    mutationFn: ({ sessionId, rating, comment }: AiFeedbackInput) =>
      api<{ ok: boolean }>(`/api/ai-assistant/sessions/${sessionId}/feedback`, {
        method: 'POST',
        body: { rating, comment },
      }),
  });
}
