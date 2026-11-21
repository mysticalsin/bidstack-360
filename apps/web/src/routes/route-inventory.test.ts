// Why this test exists: a path in the nav or in the axe scan is a page we
// claim a person can open. If the route table has no match, the app renders
// "Page not found". /invoices, /sales, and /sales/orders were that kind of
// claim. /dashboards/:id was a real id with no page.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_SETTINGS, MEMBER_SETTINGS, NAV_SECTIONS } from '@/components/layout/navConfig';

const ROUTE_FILES = [
  'src/routes/AppRoutes.tsx',
  'src/routes/AdminRoutes.tsx',
  'src/routes/BidRoutes.tsx',
  'src/routes/DevRoutes.tsx',
  'src/routes/OpsRoutes.tsx',
];

const REMOVED = ['/invoices', '/sales', '/sales/orders'];

function registeredPaths(): string[] {
  const paths: string[] = [];
  for (const file of ROUTE_FILES) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    for (const match of src.matchAll(/path="([^"]+)"/g)) {
      paths.push(match[1]!);
    }
  }
  return paths;
}

function matches(routePath: string, href: string): boolean {
  if (routePath === '*') return false;
  const pattern = routePath.replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(href);
}

function navTargets(): string[] {
  const items = [
    ...NAV_SECTIONS.flatMap((section) => section.items),
    ...ADMIN_SETTINGS,
    ...MEMBER_SETTINGS,
  ];
  return [...new Set(items.map((item) => item.to))];
}

function axeTargets(): string[] {
  const src = readFileSync(join(process.cwd(), 'e2e/a11y/axe.spec.ts'), 'utf8');
  return [...src.matchAll(/path: '([^']+)'/g)].map((match) => match[1]!.split('?')[0]!);
}

describe('route inventory', () => {
  const paths = registeredPaths();

  it('gives every nav entry a route that renders', () => {
    const missing = navTargets().filter((href) => !paths.some((route) => matches(route, href)));
    expect(missing).toEqual([]);
  });

  it('gives every axe path a route that renders', () => {
    const missing = axeTargets().filter((href) => !paths.some((route) => matches(route, href)));
    expect(missing).toEqual([]);
  });

  it('opens a dashboard id on the analytics page instead of a 404', () => {
    expect(paths).toContain('/dashboards/:id');
  });

  it('does not keep the removed sales and invoice pages', () => {
    expect(paths.filter((path) => REMOVED.includes(path))).toEqual([]);
  });
});
