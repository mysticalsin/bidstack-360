import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function StubAuthBypass() {
  const navigate = useNavigate();
  const bypass = useCallback(() => {
    navigate('/dashboard', { replace: true });
  }, [navigate]);

  return (
    <button
      type="button"
      onClick={bypass}
      className="liquid-glass inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium font-body text-white transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
    >
      Dev Mode — Skip to Dashboard
    </button>
  );
}
