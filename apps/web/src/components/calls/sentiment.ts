/** Call sentiment is −1…+1. Zero is neutral, not a 0% negative score. */

export type SentimentTone = 'positive' | 'neutral' | 'negative';

export function sentimentTone(score: number): SentimentTone {
  if (score > 0.2) return 'positive';
  if (score < -0.2) return 'negative';
  return 'neutral';
}

export function sentimentFigure(score: number): string {
  const rounded = Math.round(score * 100) / 100;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(2)}`;
}
