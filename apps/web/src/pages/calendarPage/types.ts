export interface CalendarEvent {
  id: string;
  subject: string;
  startAt: string;
  endAt: string;
  location: string | null;
  isAllDay: boolean;
  syncState: string;
  provider: string;
  createdAt: string;
}

export interface CreateEventBody {
  subject: string;
  startAt: string;
  endAt: string;
  location?: string;
  bodyPreview?: string;
  provider?: 'google_workspace' | 'microsoft_graph';
}
