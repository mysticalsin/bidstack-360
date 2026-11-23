// Recent client context attached to in-app reports and crash logs.
// Kept in memory (not localStorage) so a report describes this tab's session
// without persisting navigation history on disk.

const MAX_ACTIONS = 8;
const MAX_ACTION_LENGTH = 300;

export interface ClientLog {
  route: string;
  build: string;
  browser: string;
  timestamp: string;
  recentActions?: string[];
}

const actions: string[] = [];

export function recordClientAction(label: string): void {
  const trimmed = label.trim().slice(0, MAX_ACTION_LENGTH);
  if (!trimmed) return;
  actions.push(trimmed);
  if (actions.length > MAX_ACTIONS) {
    actions.splice(0, actions.length - MAX_ACTIONS);
  }
}

export function recentClientActions(): string[] {
  return actions.slice();
}

export function resetClientActionsForTests(): void {
  actions.length = 0;
}

export function currentClientLog(route: string, options?: { includeActions?: boolean }): ClientLog {
  const log: ClientLog = {
    route: (route || 'unknown').slice(0, 500),
    build: clientBuild(),
    browser: clientBrowser(),
    timestamp: new Date().toISOString(),
  };
  if (options?.includeActions) {
    const recent = recentClientActions();
    if (recent.length > 0) log.recentActions = recent;
  }
  return log;
}

export function currentRoute(): string {
  if (typeof window === 'undefined') return 'unknown';
  const path = `${window.location.pathname ?? ''}${window.location.search ?? ''}`;
  return path || 'unknown';
}

function clientBuild(): string {
  const release = import.meta.env.VITE_SENTRY_RELEASE;
  if (typeof release === 'string' && release.trim()) return release.trim().slice(0, 200);
  const mode = import.meta.env.MODE;
  return typeof mode === 'string' && mode ? mode.slice(0, 200) : 'unknown';
}

function clientBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  return (navigator.userAgent || 'unknown').slice(0, 400);
}
