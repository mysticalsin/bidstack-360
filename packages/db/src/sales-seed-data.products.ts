/**
 * sales-seed-data.products.ts — product category and product fixtures.
 *
 * Extracted from sales-seed-data.ts (BS-R1 file-size refactor).
 * Re-exported from sales-seed-data.ts — import from there, not here.
 */

export const fixtureProductCategories = [
  'Software',
  'Subscriptions',
  'Services',
  'Hardware',
  'Education',
  'Support',
] as const;

export type ProductSeed = {
  sku: string;
  name: string;
  category: (typeof fixtureProductCategories)[number];
  listPrice: number; // dollars, not micros — converted at seed-time
  currency: 'CAD' | 'USD' | 'EUR';
};

// Mirrors the "Top Products" list from the reference screenshot.
export const fixtureProducts: ProductSeed[] = [
  // Software
  {
    sku: 'JAMF-MAC-EDU',
    name: 'Jamf Pro for macOS (Education, Cloud)',
    category: 'Software',
    listPrice: 19_785.75,
    currency: 'CAD',
  },
  {
    sku: 'JAMF-MAC-EDU-CLOUD',
    name: 'Jamf Pro for macOS - Cloud - Ed',
    category: 'Software',
    listPrice: 30_632.0,
    currency: 'CAD',
  },
  {
    sku: 'JAMF-IOS-EDU',
    name: 'Jamf Pro for iOS (Education, Cloud)',
    category: 'Software',
    listPrice: 8_901.3,
    currency: 'CAD',
  },
  {
    sku: 'JAMF-CONNECT-EDU',
    name: 'Jamf Connect Basic (Education, Cloud)',
    category: 'Software',
    listPrice: 8_976.0,
    currency: 'CAD',
  },
  {
    sku: 'JAMF-MAC-COMM',
    name: 'Jamf for Mac (Commercial)',
    category: 'Software',
    listPrice: 5_291.75,
    currency: 'CAD',
  },
  {
    sku: 'JAMF-TVOS-EDU',
    name: 'Jamf Pro for tvOS - Cloud - Ed',
    category: 'Software',
    listPrice: 615.15,
    currency: 'CAD',
  },
  {
    sku: 'OCTORY-PRO',
    name: 'Octory Pro',
    category: 'Software',
    listPrice: 787.64,
    currency: 'CAD',
  },
  // Subscriptions
  {
    sku: 'SAAS-PLAT-STD',
    name: 'SaaS Platform — Standard tier',
    category: 'Subscriptions',
    listPrice: 14_500.0,
    currency: 'CAD',
  },
  {
    sku: 'SAAS-PLAT-ENT',
    name: 'SaaS Platform — Enterprise tier',
    category: 'Subscriptions',
    listPrice: 42_000.0,
    currency: 'CAD',
  },
  {
    sku: 'API-METER',
    name: 'Metered API access (per 100k calls)',
    category: 'Subscriptions',
    listPrice: 250.0,
    currency: 'USD',
  },
  // Services
  {
    sku: 'BANK-HOURS-50',
    name: 'Bank of Hours (50h)',
    category: 'Services',
    listPrice: 7_000.0,
    currency: 'CAD',
  },
  {
    sku: 'BANK-HOURS-100',
    name: 'Bank of Hours (100h)',
    category: 'Services',
    listPrice: 14_000.0,
    currency: 'CAD',
  },
  {
    sku: 'IMPL-FAST',
    name: 'Implementation Fast-track',
    category: 'Services',
    listPrice: 18_500.0,
    currency: 'CAD',
  },
  {
    sku: 'ARCH-REVIEW',
    name: 'Architecture Review',
    category: 'Services',
    listPrice: 9_200.0,
    currency: 'CAD',
  },
  // Hardware
  {
    sku: 'MAC-MINI-M4',
    name: 'Mac mini M4 — fleet rollout',
    category: 'Hardware',
    listPrice: 1_299.0,
    currency: 'CAD',
  },
  {
    sku: 'IPAD-PRO',
    name: 'iPad Pro 13" — district pack',
    category: 'Hardware',
    listPrice: 1_499.0,
    currency: 'CAD',
  },
  // Education
  {
    sku: 'CERT-FOUND',
    name: 'Certified Foundation training',
    category: 'Education',
    listPrice: 1_850.0,
    currency: 'CAD',
  },
  {
    sku: 'CERT-ADV',
    name: 'Certified Advanced training',
    category: 'Education',
    listPrice: 3_400.0,
    currency: 'CAD',
  },
  {
    sku: 'WORKSHOP-DAY',
    name: 'On-site workshop (per day)',
    category: 'Education',
    listPrice: 5_500.0,
    currency: 'CAD',
  },
  // Support
  {
    sku: 'SUPP-BASIC',
    name: 'Support — Basic 8x5',
    category: 'Support',
    listPrice: 4_200.0,
    currency: 'CAD',
  },
  {
    sku: 'SUPP-PREMIUM',
    name: 'Support — Premium 24x7',
    category: 'Support',
    listPrice: 12_800.0,
    currency: 'CAD',
  },
];
