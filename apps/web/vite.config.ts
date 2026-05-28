import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type PluginOption } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ command, mode }) => {
  // Belt-and-suspenders: @vitejs/plugin-react gates its dev/prod JSX transform
  // on process.env.NODE_ENV. Ensure production so jsxDEV() never leaks into the
  // bundle (Windows shells often don't forward NODE_ENV to Node).
  if (mode === 'production') {
    process.env.NODE_ENV = 'production';
  }

  const env = loadEnv(mode, path.resolve(__dirname, '../..'), 'VITE_');
  const authMode = env.VITE_AUTH_MODE ?? process.env.VITE_AUTH_MODE;
  if (command === 'build' && mode === 'production' && !env.VITE_CLERK_PUBLISHABLE_KEY) {
    if (authMode !== 'stub' || process.env.BIDSTACK_ALLOW_STUB_AUTH !== 'true') {
      throw new Error(
        'VITE_CLERK_PUBLISHABLE_KEY is required for production web builds. Set VITE_AUTH_MODE=stub with BIDSTACK_ALLOW_STUB_AUTH=true only for local/test builds.',
      );
    }
  }
  const apiUrl = env.VITE_API_URL ?? process.env.VITE_API_URL ?? 'http://localhost:4000';
  const assetBase = env.VITE_ASSET_BASE ?? process.env.ASSET_CDN_URL ?? '/';
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
    define: {
      // Force production builds for dependencies that gate their entry files on
      // process.env.NODE_ENV (React, react-dom, etc.). Without this, Vite's CJS
      // interop can resolve the development branch and bloat the bundle 2×.
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: true,
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
    base: assetBase,
    build: {
      sourcemap: process.env.NODE_ENV === 'development',
      target: 'es2022',
      cssCodeSplit: true,
      cssMinify: 'esbuild',
      assetsInlineLimit: 4096,
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
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name ?? '';
            if (/\.(woff2?|ttf|otf)$/.test(info)) {
              return 'assets/fonts/[name]-[hash][extname]';
            }
            if (/\.(png|jpe?g|gif|svg|webp|avif)$/.test(info)) {
              return 'assets/images/[name]-[hash][extname]';
            }
            return 'assets/[name]-[hash][extname]';
          },
          manualChunks(id) {
            // Rollup hands us OS-native paths; Windows uses backslashes which
            // break every `/foo/` substring check below. Normalize once.
            const normalized = id.replaceAll('\\', '/');
            if (!normalized.includes('node_modules')) return undefined;
            if (normalized.includes('/react-router') || normalized.includes('/@remix-run/'))
              return 'router';
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
            if (normalized.includes('/@sentry/')) return 'sentry';
            // Heavy geo/map deps only used by TerritoriesPage — keep them in the
            // route chunk so the rest of the app never pays the download cost.
            if (
              normalized.includes('/react-simple-maps/') ||
              normalized.includes('/d3-geo/') ||
              normalized.includes('/d3-scale/') ||
              normalized.includes('/topojson-client/')
            ) {
              return undefined;
            }
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
            // WHY separate chunks: recharts, tiptap, yjs, and dnd-kit are only
            // used by lazy-loaded route pages. Pulling them out of the vendor
            // catch-all means they are never downloaded on initial page load —
            // only when the user first navigates to analytics / RFP / collab /
            // kanban. Together they represent ~500 kB of the vendor chunk.
            //
            // recharts — only WidgetRenderer (→ AnalyticsDashboardPage, lazy)
            if (normalized.includes('/recharts/')) return 'charts';
            // @tiptap + prosemirror — only RFP draft/compliance editors (lazy)
            if (normalized.includes('/@tiptap/') || normalized.includes('/prosemirror-')) {
              return 'editor';
            }
            // yjs collaboration stack — only CollaborativeRichTextEditor (lazy)
            if (
              normalized.includes('/node_modules/yjs/') ||
              normalized.includes('/node_modules/y-indexeddb/') ||
              normalized.includes('/node_modules/lib0/') ||
              normalized.includes('/node_modules/y-protocols/')
            ) {
              return 'collab';
            }
            // @dnd-kit — only LeadKanbanView (lazy via LeadsPage)
            if (normalized.includes('/@dnd-kit/')) return 'dnd';
            return 'vendor';
          },
        },
      },
    },
  };
});
