// WebhookMessage.createdAt is timestamptz(6). A JavaScript Date keeps only
// milliseconds, so a cursor built from Date.toISOString() skips every other
// row that shares that millisecond but has a later microsecond.

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/;

export function encodeWebhookMessageCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

export function decodeWebhookMessageCursor(raw: string): { createdAt: string; id: string } | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const splitAt = text.lastIndexOf('|');
  if (splitAt <= 0) return null;
  const createdAt = text.slice(0, splitAt);
  const id = text.slice(splitAt + 1);
  if (!TIMESTAMP.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { createdAt, id };
}

/** UTC timestamp compare that keeps microseconds. Same order as timestamptz. */
export function compareWebhookMessageTime(a: string, b: string): number {
  const norm = (value: string) => {
    const match = TIMESTAMP.exec(value);
    if (!match) return value;
    return `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}Z`;
  };
  const left = norm(a);
  const right = norm(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
