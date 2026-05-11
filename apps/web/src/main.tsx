import './index.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { ApiError } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { logVitalsToConsole, reportWebVitals } from '@/lib/web-vitals';
import { App } from './App';

// Boot the Web Vitals observer once at app load. In dev/preview we log each
// metric to the console; in production this is where you'd send the metric
// to your analytics backend (Vercel Analytics, Datadog RUM, etc.).
reportWebVitals(logVitalsToConsole);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once for transient 5xx / network errors; don't retry on 4xx
      // (user error — retrying won't fix anything and wastes a roundtrip).
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (error instanceof ApiError) {
          return error.status >= 500 || error.status === 0;
        }
        return true;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      // Mutations retry exactly once on a 5xx/network drop. 4xx surfaces
      // immediately so the optimistic rollback fires without delay.
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false;
        if (error instanceof ApiError) {
          return error.status >= 500 || error.status === 0;
        }
        return true;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const root = createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <AuthProvider publishableKey={clerkKey}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
);
