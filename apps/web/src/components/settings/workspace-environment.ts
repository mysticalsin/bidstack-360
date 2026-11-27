export type WorkspaceEnvironmentTone = 'jade' | 'amber' | 'gray';

export type WorkspaceEnvironment =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; label: string; tone: WorkspaceEnvironmentTone };

/**
 * Workspace environment is the data this org is showing, not Vite's build mode.
 * The public demo is compiled with MODE=production. That string is how the
 * bundle was built. It is not a production org. A missing answer stays missing
 * instead of falling back to the build mode.
 */
export function workspaceEnvironment(input: {
  status: 'loading' | 'error' | 'ready';
  dataMode?: 'demo' | 'real' | null;
  viteMode?: string | null;
}): WorkspaceEnvironment {
  if (input.status === 'loading') return { state: 'loading' };
  if (input.status === 'error' || (input.status === 'ready' && input.dataMode == null)) {
    return { state: 'error' };
  }
  if (input.dataMode === 'demo') return { state: 'ready', label: 'Demo', tone: 'amber' };
  const mode = (input.viteMode ?? '').trim().toLowerCase() || 'development';
  const tone: WorkspaceEnvironmentTone =
    mode === 'production' ? 'jade' : mode === 'staging' ? 'amber' : 'gray';
  return { state: 'ready', label: mode, tone };
}
