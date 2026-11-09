import { createServer, type Server, type Socket } from 'node:net';

const READY_INFO = 'redis_version:7.0.15\r\nloading:0\r\nmaxmemory_policy:noeviction\r\n';

/** Parses RESP arrays of bulk strings, enough for ioredis requests. */
function takeCommands(buffer: string): { commands: string[][]; rest: string } {
  const commands: string[][] = [];
  let rest = buffer;
  for (;;) {
    const header = /^\*(\d+)\r\n/.exec(rest);
    if (!header) break;
    let pos = header[0].length;
    const parts: string[] = [];
    for (let i = 0; i < Number(header[1]); i++) {
      const len = /^\$(\d+)\r\n/.exec(rest.slice(pos));
      if (!len || rest.length < pos + len[0].length + Number(len[1]) + 2) return { commands, rest };
      pos += len[0].length;
      parts.push(rest.slice(pos, pos + Number(len[1])));
      pos += Number(len[1]) + 2;
    }
    commands.push(parts);
    rest = rest.slice(pos);
  }
  return { commands, rest };
}

export type FrozenRedis = { port: number; received: string[]; close(): Promise<void> };

/**
 * Answers the ioredis connection handshake and ready check so the client
 * reports 'ready', then never replies to anything else: a Redis that froze
 * after connecting (SIGSTOP, a wedged primary, a stalled proxy). `replies`
 * maps further commands to raw RESP answers, for a Redis that is healthy for
 * those commands.
 */
export async function startFrozenRedis(replies: Record<string, string> = {}): Promise<FrozenRedis> {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk) => {
      const parsed = takeCommands(buffer + chunk.toString('latin1'));
      buffer = parsed.rest;
      for (const [name = ''] of parsed.commands) {
        const command = name.toUpperCase();
        received.push(command);
        if (command === 'INFO') socket.write(`$${READY_INFO.length}\r\n${READY_INFO}\r\n`);
        else if (command === 'CLIENT' || command === 'SELECT') socket.write('+OK\r\n');
        else if (replies[command] !== undefined) socket.write(replies[command]);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
