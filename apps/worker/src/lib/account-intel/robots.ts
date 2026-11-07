/**
 * robots.txt (RFC 9309) parsing for account intelligence fetches. Groups by
 * user agent, the longest matching rule wins, ties go to Allow.
 */

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

/** Parsed robots.txt. `disallowAll` is set when the file could not be read for a server error. */
export interface RobotsRules {
  groups: RobotsGroup[];
  sitemaps: string[];
  disallowAll?: boolean;
}

/** Rules that allow everything (no robots.txt, or a 4xx answer). */
export const ALLOW_ALL: RobotsRules = { groups: [], sitemaps: [] };

/** Parse a robots.txt body. */
export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'sitemap') {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && value === '') continue;
      cur.rules.push({ allow: field === 'allow', path: value });
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}

/** True when `agent` (the product token of our User-Agent) may fetch `path`. */
export function robotsAllows(rules: RobotsRules, agent: string, path: string): boolean {
  if (rules.disallowAll) return false;
  const token = agent.toLowerCase();
  const named = rules.groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const groups = named.length ? named : rules.groups.filter((g) => g.agents.includes('*'));
  let best: RobotsRule | null = null;
  for (const g of groups) {
    for (const r of g.rules) {
      if (!ruleMatches(r.path, path)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}
