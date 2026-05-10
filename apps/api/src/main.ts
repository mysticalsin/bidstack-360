import 'dotenv-flow/config';
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
