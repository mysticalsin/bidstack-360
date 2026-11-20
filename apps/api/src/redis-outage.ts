/** Port of a loopback Redis the outage test is allowed to stop. Anything else is left alone. */
export function redisOutagePort(url: string, optedIn: boolean): number | null {
  if (!optedIn) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'redis:') return null;
  const host = parsed.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
  const port = Number(parsed.port || '6379');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}
