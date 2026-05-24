// Inline SVG icons — zero dependency, tree-shakable, dark-mode aware via
// currentColor. Keeps the bundle leaner than pulling lucide-react.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export const Icon = {
  Pipeline(props: IconProps) {
    return (
      <svg {...base(props)}>
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
        <rect x="16" y="4" width="5" height="7" rx="1.5" />
      </svg>
    );
  },
  Sparkle(props: IconProps) {
    return (
      <svg {...base(props)}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
    );
  },
  Compass(props: IconProps) {
    return (
      <svg {...base(props)}>
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-2 6-6 2 2-6 6-2z" />
      </svg>
    );
  },
  Workflow(props: IconProps) {
    return (
      <svg {...base(props)}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M10 6.5h4M17.5 10v4M14 17.5h-4M6.5 14v-4" />
      </svg>
    );
  },
  Target(props: IconProps) {
    return (
      <svg {...base(props)}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    );
  },
  Shield(props: IconProps) {
    return (
      <svg {...base(props)}>
        <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  },
  ArrowRight(props: IconProps) {
    return (
      <svg {...base(props)}>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
    );
  },
  Check(props: IconProps) {
    return (
      <svg {...base(props)}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  },
  X(props: IconProps) {
    return (
      <svg {...base(props)}>
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="6" y1="18" x2="18" y2="6" />
      </svg>
    );
  },
  Quote(props: IconProps) {
    return (
      <svg {...base(props)}>
        <path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a3 3 0 0 1-3 3" />
        <path d="M19 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3a3 3 0 0 1-3 3" />
      </svg>
    );
  },
};
