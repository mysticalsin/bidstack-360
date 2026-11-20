import type { CalendarEvent } from './types';

// Solid 600-weight fills: white 12px text needs at least 4.5:1 in both themes.
const PROVIDER_FILL: Record<string, string> = {
  google_workspace: 'bg-blue-600',
  microsoft_graph: 'bg-purple-600',
};

export function eventFill(ev: CalendarEvent): string {
  return PROVIDER_FILL[ev.provider] ?? 'bg-gray-600';
}
