import { AnimatedNumber } from '@/components/motion/AnimatedNumber';

const NUMBER_RE = /(-?\d[\d,]*(?:\.\d+)?)/g;

interface Props {
  value: string;
  duration?: number;
}

export function AnimatedMetric({ value, duration = 0.85 }: Props) {
  const matches = [...value.matchAll(NUMBER_RE)];
  if (matches.length !== 1 || value.includes('/')) return <>{value}</>;

  const match = matches[0];
  if (!match) return <>{value}</>;
  const literal = match[1] ?? '';
  const index = match.index ?? 0;
  const plain = literal.replace(/,/g, '');
  const target = Number(plain);
  // Past the point where a double keeps the written cent, show the text.
  if (!Number.isFinite(target) || !Number.isSafeInteger(Math.trunc(target))) return <>{value}</>;
  if (plain.includes('.')) {
    const [whole, frac = ''] = plain.split('.');
    const digits = Math.min(frac.length, 2);
    const expected = `${whole}.${frac.slice(0, digits).padEnd(digits, '0')}`;
    if (target.toFixed(digits) !== expected) return <>{value}</>;
  }

  const prefix = value.slice(0, index);
  const suffix = value.slice(index + literal.length);
  const hasDecimals = literal.includes('.');

  return (
    <span className="animated-metric">
      {prefix}
      <AnimatedNumber
        value={target}
        duration={duration}
        format={(n) =>
          hasDecimals
            ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : Math.round(n).toLocaleString()
        }
      />
      {suffix}
    </span>
  );
}
