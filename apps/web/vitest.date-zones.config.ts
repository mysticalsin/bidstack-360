import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unlike vitest.config.ts, this file does not pin TZ=UTC. The zone runner
// starts the process with TZ=America/Sao_Paulo or another zone west of UTC
// so date-only strings can be proven not to slip to the previous day.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/lib/plain-date.test.ts'],
  },
});
