export function ApexLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="8" y="8" width="24" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" transform="rotate(45 20 20)" />
      <rect x="14" y="14" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.5" transform="rotate(45 20 20)" />
    </svg>
  );
}
