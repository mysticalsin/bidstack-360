import { createContext, useContext, type ReactNode } from 'react';

import type { PoloPublicIdentity } from '@/hooks/usePoloIdentity';

const RuntimeModeContext = createContext<PoloPublicIdentity | null>(null);

export function RuntimeModeProvider({
  value,
  children,
}: {
  value: PoloPublicIdentity;
  children: ReactNode;
}) {
  return <RuntimeModeContext.Provider value={value}>{children}</RuntimeModeContext.Provider>;
}

/** Boot snapshot from GET /identity. Null in tests that do not mount the provider. */
export function useRuntimeMode(): PoloPublicIdentity | null {
  return useContext(RuntimeModeContext);
}
