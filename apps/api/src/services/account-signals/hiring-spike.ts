export type HiringSpike = { week: number; count: number; median: number };

/**
 * A hiring spike is a week with at least 5 posts and at least twice the median week.
 * A complete page counts quiet weeks as 0. A capped page never read those weeks,
 * so padding them with 0 pulls the median down and a normal week looks like a spike.
 */
export function hiringSpikeWeeks(
  weekCounts: ReadonlyMap<number, number>,
  windowDays: number,
  pageCapped: boolean,
): HiringSpike[] {
  const observed = [...weekCounts.values()];
  const totalWeeks = Math.max(weekCounts.size, Math.ceil(windowDays / 7));
  const quiet = Math.max(0, totalWeeks - weekCounts.size);
  const counts = (pageCapped ? observed : [...observed, ...Array<number>(quiet).fill(0)]).sort(
    (a, b) => a - b,
  );
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  const spikes: HiringSpike[] = [];
  for (const [week, count] of weekCounts) {
    if (count >= 5 && count >= median * 2) spikes.push({ week, count, median });
  }
  return spikes;
}
