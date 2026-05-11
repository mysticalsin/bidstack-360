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
      // react-dom 18 production minified is ~145 KB; use 200 KB so we get warned
      // about app code creep but not about React itself.
      chunkSizeWarningLimit: 200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react-router')) return 'router';
            if (id.includes('/@tanstack/')) return 'tanstack';
            if (id.includes('/@radix-ui/')) return 'radix';
            if (id.includes('/zustand/')) return 'state';
            if (id.includes('/zod/')) return 'zod';
            // Exact-match React core packages only — avoid matching @clerk/clerk-react,
            // react-router, @types/react, etc.
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
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
