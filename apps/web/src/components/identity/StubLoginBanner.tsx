import { STUB_LOGIN_BANNER } from '@bidstack/shared';

import { useRuntimeMode } from '@/lib/runtime-mode';

/**
 * Persistent notice while stub auth is the sign-in.
 * It is not dismissible. The public demo door does not use it.
 */
export function StubLoginBanner() {
  const runtime = useRuntimeMode();
  if (!runtime?.stubBanner) return null;
  return (
    <div
      role="status"
      data-testid="stub-login-banner"
      className="border-b border-rose-700/40 bg-rose-600 px-4 py-2 text-center text-sm font-semibold text-white"
    >
      {runtime.stubBanner || STUB_LOGIN_BANNER}
    </div>
  );
}
