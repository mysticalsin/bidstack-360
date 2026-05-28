import { useNavigate } from 'react-router-dom';

/**
 * Minimal transparent navbar — just the brand wordmark.
 *
 * No marketing links, no CTA, no hamburger. Clean and focused.
 */
export function TransparentNavbar() {
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-transparent">
      <div className="mx-auto flex h-16 max-w-7xl items-center px-6 md:px-10">
        {/* Brand wordmark */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-white font-body font-semibold text-lg tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(73,98%,57%)]/50 rounded-sm"
        >
          <span>BidStack 360°</span>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: 'hsl(73, 98%, 57%)' }}
            aria-hidden="true"
          />
        </button>
      </div>
    </nav>
  );
}
