export function VelaLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path d="M20 6L34 32H6L20 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 16L26 28H14L20 16Z" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}
