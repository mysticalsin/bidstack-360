const DEV_WEB_PORTS = ['5173', '5174', '4173', '4174'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function parseOrigin(origin: string): URL | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  const url = parseOrigin(origin);
  if (!url) return false;
  return LOOPBACK_HOSTNAMES.has(url.hostname);
}

function originFor(protocol: string, host: string, port: string): string {
  return `${protocol}//${host}${port ? `:${port}` : ''}`;
}

function addLoopbackVariants(origins: Set<string>, url: URL): void {
  if (!isLoopbackOrigin(url.origin)) return;
  for (const host of LOOPBACK_HOSTS) {
    origins.add(originFor(url.protocol, host, url.port));
  }
}

export function buildAllowedCorsOrigins(
  publicBaseUrl: string | undefined,
  nodeEnv: string,
): string[] {
  const origins = new Set<string>();
  const publicUrl = publicBaseUrl ? parseOrigin(publicBaseUrl) : null;

  if (publicUrl) {
    origins.add(publicUrl.origin);
    if (nodeEnv !== 'production') addLoopbackVariants(origins, publicUrl);
  }

  if (nodeEnv !== 'production') {
    for (const port of DEV_WEB_PORTS) {
      for (const host of LOOPBACK_HOSTS) {
        origins.add(originFor('http:', host, port));
      }
    }
  }

  return [...origins];
}
