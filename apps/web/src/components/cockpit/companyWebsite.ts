// The account header prints the domain. That word may open the stored site
// only when the site is http(s) and its host is the domain or a subdomain.
// A script URL, a login embedded in the address, or another host stays text.

/** http(s) URL with no embedded login. Null for script, data, or a blank. */
export function publicHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

function domainRoot(domain: string | null | undefined): string | null {
  const root = (domain ?? '').trim().replace(/\.$/, '').toLowerCase();
  if (!root || !root.includes('.') || /[\s/@\\]/.test(root)) return null;
  return root;
}

/**
 * Address for the domain shown on the account. The host must be that domain
 * or a subdomain of it, so the word "ci.com" never opens a different site.
 */
export function companyWebsiteHref(
  domain: string | null | undefined,
  website: string | null | undefined,
): string | null {
  const href = publicHttpUrl(website);
  const root = domainRoot(domain);
  if (!href || !root) return null;
  const host = new URL(href).hostname.replace(/\.$/, '').toLowerCase();
  if (host !== root && !host.endsWith(`.${root}`)) return null;
  // A numeric host or a local name is not the public site printed on the account.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost' || host.endsWith('.local')) {
    return null;
  }
  return href;
}
