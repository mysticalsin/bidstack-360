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
  const target = Number(literal.replace(/,/g, ''));
  if (!Number.isFinite(target)) return <>{value}</>;

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
