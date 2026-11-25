// An empty risk and compliance file is not a clean account. "All clear" is
// only true once rows exist and none of them are still open.

export type OpenIssuesPosture = 'unrecorded' | 'clear' | 'open';

export function openIssuesPosture(recorded: number, open: number): OpenIssuesPosture {
  if (recorded <= 0) return 'unrecorded';
  if (open <= 0) return 'clear';
  return 'open';
}
