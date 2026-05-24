import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Marketing site config — separate from apps/web so it can deploy independently
// to bidstack.dev (the public marketing domain) while apps/web targets app.bidstack.dev.
// Constraints:
//   - No Clerk / Sentry / data layer. This is a fully static marketing surface.
//   - Bundle budget: hero JS must stay < 100KB gzipped (per Wave 2 brief).
//   - Honour the same NODE_ENV gate as apps/web so React's prod branch resolves
//     and we don't ship jsxDEV() to visitors.
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    process.env.NODE_ENV = 'production';
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        mode === 'production' ? 'production' : 'development',
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      host: true,
    },
    preview: {
      port: 4174,
      strictPort: true,
    },
    build: {
      // Keep sourcemaps in dev only — production marketing site stays lean.
      sourcemap: false,
      target: 'es2022',
      cssCodeSplit: true,
      cssMinify: 'esbuild',
      // Strict chunk budget: marketing should ship < 100KB gzipped per the brief.
      chunkSizeWarningLimit: 200,
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Rollup hands us OS-native paths; Windows uses backslashes which
            // break every `/foo/` substring check below. Normalize once.
            const normalized = id.replaceAll('\\', '/');
            if (!normalized.includes('node_modules')) return undefined;
            if (normalized.includes('/react-router') || normalized.includes('/@remix-run/'))
              return 'router';
            if (normalized.includes('/node_modules/react-dom/')) return 'react-dom';
            if (
              normalized.includes('/node_modules/react/') ||
              normalized.includes('/node_modules/scheduler/')
            ) {
              return 'react';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
