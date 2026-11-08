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
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  /** Created in Polo and not pushed to the provider calendar (read-only grant). */
  localOnly: boolean;
}

export interface CreateEventBody {
  subject: string;
  startAt: string;
  endAt: string;
  location?: string;
  bodyPreview?: string;
  provider?: 'google_workspace' | 'microsoft_graph';
  isAllDay?: boolean;
  /** Retry key so a double submit creates one event. */
  clientRequestId?: string;
}
