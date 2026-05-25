export function AeonLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="2.5" fill="currentColor" />
    </svg>
  );
}
