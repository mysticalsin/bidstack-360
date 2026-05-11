import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), 'VITE_');
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:4000';
  // Bundle analyzer fires only in `--mode analyze`; keeps prod builds clean.
  const analyze = mode === 'analyze';

  return {
    plugins: [
      react(),
      tailwindcss(),
      analyze &&
        (visualizer({
          filename: 'dist/bundle-stats.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          open: true,
        }) as PluginOption),
    ].filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/webhooks': { target: apiUrl, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': { target: apiUrl, changeOrigin: true },
        '/webhooks': { target: apiUrl, changeOrigin: true },
      },
    },
    build: {
      sourcemap: process.env.NODE_ENV === 'development',
      target: 'es2022',
      // React DOM is the largest legitimate vendor chunk in this app. Keep the
      // limit tight enough to catch app-code creep without warning on framework
      // bytes we intentionally isolate below.
      chunkSizeWarningLimit: 300,
      // Why both: gzip is what cloudflare/vercel/cloudfront serve today;
      // brotli is what nginx-front-of-S3 and the visitor's modern browser
      // can negotiate when configured. Surfacing both numbers in the build
      // log lets us optimize for the smaller of the two without guessing.
      reportCompressedSize: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Rollup hands us OS-native paths; Windows uses backslashes which
            // break every `/foo/` substring check below. Normalize once.
            const normalized = id.replaceAll('\\', '/');
            if (!normalized.includes('node_modules')) return undefined;
            if (normalized.includes('/react-router')) return 'router';
            if (normalized.includes('/@tanstack/')) return 'tanstack';
            if (normalized.includes('/@radix-ui/')) return 'radix';
            if (normalized.includes('/zustand/')) return 'state';
            if (normalized.includes('/zod/')) return 'zod';
            // Isolate the entire @clerk/* family (clerk-react, clerk-js,
            // shared, types) into one chunk so the `auth.tsx` dynamic
            // import loads exactly one network request when a publishableKey
            // is present, and contributes ZERO bytes to the eager bundle in
            // stub mode. Audit B2 (2026-05-10) regression guard.
            if (normalized.includes('/@clerk/')) return 'clerk';
            // framer-motion ships ~50KB gzipped — isolate so the rest of
            // vendor stays lean and motion can be cached separately across
            // deploys where only app code changes.
            if (
              normalized.includes('/node_modules/framer-motion/') ||
              normalized.includes('/node_modules/motion-utils/') ||
              normalized.includes('/node_modules/motion-dom/')
            ) {
              return 'motion';
            }
            if (normalized.includes('/node_modules/react-dom/')) return 'react-dom';
            // Exact-match React core packages only — avoid matching @clerk/clerk-react,
            // react-router, react-dom, @types/react, etc.
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
