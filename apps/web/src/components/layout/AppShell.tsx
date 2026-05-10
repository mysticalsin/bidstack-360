import type { ReactNode } from 'react';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full bg-[var(--surface-page)]">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main
          id="main"
          className="flex-1 overflow-y-auto"
          aria-label="Main content"
          tabIndex={-1}
        >
          <div className="mx-auto w-full max-w-[1440px] px-6 py-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
