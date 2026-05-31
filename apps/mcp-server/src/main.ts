import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import { prisma } from '@bidstack/db';
import { buildMcpServer } from './server.js';

const port = Number(process.env.PORT_MCP ?? 4001);
const host = process.env.HOST ?? '0.0.0.0';
const healthPort = Number(process.env.MCP_HEALTH_PORT || 4003);

const server = await buildMcpServer();

try {
  await server.listen({ port, host });
  server.log.info({ port, host }, 'BidStack MCP server ready');
} catch (err) {
  server.log.error(err, 'failed to start mcp-server');
  process.exit(1);
}

// HTTP health probe for Docker / orchestrators. Probes the DB (every MCP tool
// uses Prisma), so a pod with a dead DB is taken out of rotation instead of
// being handed traffic it can only fail.
const healthServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    void (async () => {
      let dbReady: boolean;
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbReady = true;
      } catch {
        dbReady = false;
      }
      res.writeHead(dbReady ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: dbReady ? 'ok' : 'error',
          db: dbReady ? 'connected' : 'disconnected',
        }),
      );
    })();
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(healthPort, host, () => {
  server.log.info({ healthPort, host }, 'MCP health probe ready');
});

// Graceful shutdown: on a deploy roll, drain the MCP server + health probe +
// Prisma pool instead of being hard-killed mid-request.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.log.info({ signal }, 'mcp-server shutting down');
    void (async () => {
      try {
        await server.close();
        healthServer.close();
        await prisma.$disconnect();
      } catch (err) {
        server.log.error(err, 'error during mcp-server shutdown');
      } finally {
        process.exit(0);
      }
    })();
  });
}
