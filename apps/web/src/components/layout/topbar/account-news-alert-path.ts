// The news scan stores `/dashboard?account=<id>#watchdog`.
// Home does not read `account`, so that open lands on the portfolio.
// The account page is `/accounts/<id>` and the feed element is `#watchdog`.
// Every other URL, including a task-list marker, is returned unchanged.

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEWS_ALERT = /^\/dashboard\?account=([^&#]+)#watchdog$/;

export function accountNewsAlertPath(url: string | null): string | null {
  if (url == null) return null;
  const match = NEWS_ALERT.exec(url);
  if (!match?.[1]) return url;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return url;
  }
  if (!ACCOUNT_ID.test(id)) return url;
  return `/accounts/${id}#watchdog`;
}
