export function ZenoLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path d="M20 4L35.5 12.5V27.5L20 36L4.5 27.5V12.5L20 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 12L28 17V27L20 32L12 27V17L20 12Z" stroke="currentColor" strokeWidth="1" opacity="0.5" strokeLinejoin="round" />
    </svg>
  );
}
