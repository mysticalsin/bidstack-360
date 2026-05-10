import 'dotenv-flow/config';
import { buildMcpServer } from './server.js';

const port = Number(process.env.PORT_MCP ?? 4001);
const host = process.env.HOST ?? '0.0.0.0';

const server = await buildMcpServer();

try {
  await server.listen({ port, host });
  server.log.info({ port, host }, 'BidStack MCP server ready');
} catch (err) {
  server.log.error(err, 'failed to start mcp-server');
  process.exit(1);
}
