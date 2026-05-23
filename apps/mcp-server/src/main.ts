import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

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

// Minimal HTTP health probe for Docker / orchestrators
const healthServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(healthPort, host, () => {
  server.log.info({ healthPort, host }, 'MCP health probe ready');
});
