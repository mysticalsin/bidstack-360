export function OrbitLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <ellipse cx="20" cy="20" rx="14" ry="6" stroke="currentColor" strokeWidth="1.5" transform="rotate(-30 20 20)" />
      <ellipse cx="20" cy="20" rx="14" ry="6" stroke="currentColor" strokeWidth="1.5" transform="rotate(30 20 20)" opacity="0.4" />
      <circle cx="20" cy="20" r="3" fill="currentColor" />
    </svg>
  );
}
