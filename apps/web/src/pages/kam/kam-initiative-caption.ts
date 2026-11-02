/**
 * Column count on the key-account initiative board. The list route already
 * reads one row past the page and drops it. `latest` is the drawn page.
 * A continued page is not every initiative. A shorter page keeps
 * "Stage · N". No initiative total is invented.
 */
export function kamInitiativeColumnHeading(
  stageLabel: string,
  count: number,
  pageContinues: boolean,
  latest: number,
): string {
  if (pageContinues) {
    return `${stageLabel} · ${count} in the latest ${latest}, not every initiative`;
  }
  return `${stageLabel} · ${count}`;
}
