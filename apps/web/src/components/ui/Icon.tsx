// Lucide-style inline SVG set, ported from the BidStack 360° design prototype.
// Stroke-based icons inherit currentColor — wraps a fixed viewBox for crispness
// at any size. Limit to icons actually used in the shell; add more as needed.

import type { CSSProperties } from 'react';

const PATHS: Record<string, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="11" y="4" width="6" height="16" rx="1" />
      <rect x="19" y="4" width="2" height="16" rx="1" />
    </>
  ),
  contacts: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 21a6 6 0 0112 0M16 4a4 4 0 010 8M19 21v-1a4 4 0 00-3-3.87" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 00-9 9 8 8 0 008 8h1.5a1.5 1.5 0 001.2-2.4 1.5 1.5 0 011.2-2.4H17a4 4 0 004-4 8 8 0 00-9-8.2z" />
      <circle cx="7.5" cy="10.5" r=".5" />
      <circle cx="10" cy="7.5" r=".5" />
      <circle cx="14" cy="7.5" r=".5" />
      <circle cx="16.5" cy="10.5" r=".5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h5M15 6h5M4 12h9M17 12h3M4 18h3M11 18h9" />
      <circle cx="12" cy="6" r="3" />
      <circle cx="16" cy="12" r="3" />
      <circle cx="8" cy="18" r="3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 016.5 3H20v17H6.5A2.5 2.5 0 014 17.5v-12z" />
      <path d="M4 17.5A2.5 2.5 0 016.5 15H20M8 7h8" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M16 3v4h4M8 11h8M8 15h8M8 19h5" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07A19.5 19.5 0 013.16 12 19.8 19.8 0 01.09 3.37 2 2 0 012.06 1.2h3a2 2 0 012 1.72c.12.9.33 1.77.63 2.61a2 2 0 01-.45 2.11L6 8.9a16 16 0 007.1 7.1l1.26-1.24a2 2 0 012.11-.45c.84.3 1.71.51 2.61.63A2 2 0 0122 16.92z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  reports: (
    <>
      <path d="M3 17l6-6 4 4 8-8M21 7v6h-6" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.8.4l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.4-1.8l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 1112 0c0 7 3 7 3 9H3c0-2 3-2 3-9zM10 21a2 2 0 004 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4M12 17h.01" />
    </>
  ),
  caret: <path d="M6 9l6 6 6-6" />,
  caretup: <path d="M6 15l6-6 6 6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  sparkle: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
    </>
  ),
  dollar: <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3" />
    </>
  ),
  crown: (
    <>
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
      <path d="M5 19h14" />
    </>
  ),
  growth: <path d="M3 17l6-6 4 4 8-8M21 7v6h-6" />,
  warning: (
    <>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18h.01" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <path d="M6 14h12v7H6zM18 12h.01" />
    </>
  ),
  download: <path d="M12 3v13M6 11l6 6 6-6M5 21h14" />,
  building: (
    <>
      <path d="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 8h.01M9 12h.01M9 16h.01M15 8h.01M15 12h.01M15 16h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  moon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  // Lucide's "star" — stroke-only outline.
  star: (
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
  ),
  // Same path, but the caller fills it via currentColor for the active state.
  starFilled: (
    <path
      d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
      fill="currentColor"
    />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2v20l4-2 4 2 4-2 4 2V2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  package: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  messageCircle: (
    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
    </>
  ),
  'git-branch': (
    <>
      <path d="M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a3 3 0 01-3 3H9a3 3 0 00-3 3" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  ariaHidden?: boolean;
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  className,
  style,
  ariaHidden = true,
}: IconProps) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={ariaHidden}
    >
      {path}
    </svg>
  );
}
