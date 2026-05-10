// Load .env from the repo root regardless of where the process was started.
// `pnpm --filter @bidstack/api dev` runs with cwd=apps/api, but the canonical
// .env lives at the monorepo root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import { buildServer } from './server.js';

const port = Number(process.env.PORT_API ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const server = await buildServer();

try {
  await server.listen({ port, host });
  server.log.info({ port, host }, 'BidStack 360° API ready');
} catch (err) {
  server.log.error(err, 'failed to start');
  process.exit(1);
}
