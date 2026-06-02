export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === '[::1]' ||
    h.startsWith('::ffff:127.') ||
    h.startsWith('10.') ||
    h.startsWith('172.16.') ||
    h.startsWith('172.17.') ||
    h.startsWith('172.18.') ||
    h.startsWith('172.19.') ||
    h.startsWith('172.20.') ||
    h.startsWith('172.21.') ||
    h.startsWith('172.22.') ||
    h.startsWith('172.23.') ||
    h.startsWith('172.24.') ||
    h.startsWith('172.25.') ||
    h.startsWith('172.26.') ||
    h.startsWith('172.27.') ||
    h.startsWith('172.28.') ||
    h.startsWith('172.29.') ||
    h.startsWith('172.30.') ||
    h.startsWith('172.31.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  ) {
    return false;
  }
  return true;
}

export function assertSafeWebhookUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('url must use HTTPS');
  }

  if (!isPublicHostname(url.hostname)) {
    throw new Error('url must not point to a private or internal address');
  }
}
