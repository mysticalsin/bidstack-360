/**
 * Caption for the org-dashboard watchdog pulse.
 * newAlertCount is the full NEW set. The feed draws only the latest alerts,
 * so a risk count from that page is not the whole book. Demo rows are sample
 * signals (title starts with "Sample:", or sample is true). They are not a
 * live risk.
 */

export interface PulseAlert {
  title: string;
  implication: string;
  sample?: boolean;
}

export interface PulseFeed {
  newAlertCount: number;
  alerts: PulseAlert[];
}

export type PulseTone = 'calm' | 'watch' | 'alert';

function isSampleAlert(alert: PulseAlert): boolean {
  if (alert.sample === true) return true;
  if (alert.sample === false) return false;
  return /^sample:/i.test(alert.title);
}

function allSample(alerts: PulseAlert[]): boolean {
  return alerts.length > 0 && alerts.every(isSampleAlert);
}

export function watchdogPulseCaption(feed: PulseFeed): string {
  const fresh = feed.newAlertCount;
  if (fresh <= 0) return 'Watchdog: all quiet';
  const loaded = feed.alerts;
  const sample = allSample(loaded);
  const risks = loaded.filter((alert) => alert.implication === 'RISK').length;
  const signals = `Watchdog: ${fresh} new signal${fresh === 1 ? '' : 's'}${sample ? ' (sample)' : ''}`;
  if (risks <= 0) return signals;
  const riskWord = sample
    ? `${risks} sample risk${risks === 1 ? '' : 's'}`
    : `${risks} risk${risks === 1 ? '' : 's'}`;
  if (fresh > loaded.length) return `${signals} · ${riskWord} in the latest ${loaded.length}`;
  return `${signals} · ${riskWord}`;
}

/** A page of sample rows stays on watch. A live risk in the loaded page is an alert. */
export function watchdogPulseTone(feed: PulseFeed): PulseTone {
  const loaded = feed.alerts;
  if (allSample(loaded)) return feed.newAlertCount > 0 ? 'watch' : 'calm';
  if (loaded.some((alert) => alert.implication === 'RISK')) return 'alert';
  if (feed.newAlertCount > 0) return 'watch';
  return 'calm';
}
