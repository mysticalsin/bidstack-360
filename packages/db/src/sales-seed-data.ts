// Sales module seed fixtures — Sprint 21.
// Mirrors the shape of an Odoo Sales Dashboard so the SalesDashboardPage
// has realistic data on first boot: 6 categories, ~30 products, 20 customers
// across 8 countries with one salesperson each, and ~80 sales orders mixing
// quotations (draft/sent) and confirmed sales orders over a 3-month window.
//
// Money is in **micros** (integer × 1e6) per the rest of BidStack — formatters
// divide back at the edge.

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

export type CustomerSeed = {
  name: string;
  countryCode: string; // ISO-3166 alpha-2
  salespersonEmail: string; // must match a fixtureUsers email
  currency: 'CAD' | 'USD' | 'EUR';
};

// Mirrors customers from the reference screenshot, expanded for 8 countries.
export const fixtureSalesCustomers: CustomerSeed[] = [
  {
    name: 'La Presse Inc',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'FLORIDA GUL COAST UNIVERSITY',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Centre de Services Scolaire des Découvreurs',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Cégep de Lanaudière, Guillaume Chartrand',
    countryCode: 'CA',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Brilliance Employment & Enterprise Strategy Inc.',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Softchoice LP',
    countryCode: 'CA',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Dublin City Schools',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Nuovo Photography',
    countryCode: 'IT',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Technologies Plotly Inc',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'University of Toronto',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'BBC Studios',
    countryCode: 'GB',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Mercedes-Benz AG',
    countryCode: 'DE',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Sanofi SA',
    countryCode: 'FR',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Telefónica España',
    countryCode: 'ES',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'EUR',
  },
  {
    name: 'Banco do Brasil',
    countryCode: 'BR',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Tata Consultancy Services',
    countryCode: 'IN',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'New York City Department of Education',
    countryCode: 'US',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Los Angeles Unified School District',
    countryCode: 'US',
    salespersonEmail: 'benjamin.richer@mantu.com',
    currency: 'USD',
  },
  {
    name: 'Université de Montréal',
    countryCode: 'CA',
    salespersonEmail: 'tony.walteur@mantu.com',
    currency: 'CAD',
  },
  {
    name: 'Bibliothèque et Archives nationales du Québec',
    countryCode: 'CA',
    salespersonEmail: 'sarah.poncet@mantu.com',
    currency: 'CAD',
  },
];

export type OrderSeedLine = { sku: string; qty: number; unitPrice: number };

export type SalesOrderSeed = {
  number: string;
  state: 'draft' | 'sent' | 'confirmed' | 'done' | 'cancelled';
  customerName: string;
  /** Days back from "today" — the seed sets orderDate to (now - offsetDays). */
  daysAgo: number;
  lines: OrderSeedLine[];
};

// 80 deterministic seed orders across a 90-day window. Mix of quotations and
// confirmed orders so the dashboard's "Quotations" and "Orders" KPIs land
// at realistic counts (≥40 quotations, ≥5 confirmed, ≥1 done) and the
// monthly chart has a peak month (March-equivalent → 30-day window).
function makeOrders(): SalesOrderSeed[] {
  const out: SalesOrderSeed[] = [];
  let id = 1;
  const cust = (i: number) => fixtureSalesCustomers[i % fixtureSalesCustomers.length]!.name;

  // Top revenue quotations (Q1) — match the screenshot's top-10 amounts.
  const big: Array<{
    customer: string;
    lines: OrderSeedLine[];
    daysAgo: number;
    state: SalesOrderSeed['state'];
  }> = [
    {
      customer: 'La Presse Inc',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 2, unitPrice: 19_785.75 },
        { sku: 'SAAS-PLAT-ENT', qty: 1, unitPrice: 42_000 },
        { sku: 'IMPL-FAST', qty: 1, unitPrice: 18_500 },
        { sku: 'SUPP-PREMIUM', qty: 1, unitPrice: 12_800 },
        { sku: 'BANK-HOURS-100', qty: 6, unitPrice: 14_000 },
      ],
      daysAgo: 18,
      state: 'sent',
    },
    {
      customer: 'La Presse Inc',
      lines: [
        { sku: 'JAMF-MAC-EDU-CLOUD', qty: 3, unitPrice: 30_632 },
        { sku: 'SUPP-PREMIUM', qty: 1, unitPrice: 12_800 },
        { sku: 'BANK-HOURS-100', qty: 4, unitPrice: 14_000 },
      ],
      daysAgo: 22,
      state: 'draft',
    },
    {
      customer: 'FLORIDA GUL COAST UNIVERSITY',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 3, unitPrice: 19_785.75 },
        { sku: 'JAMF-IOS-EDU', qty: 4, unitPrice: 8_901.3 },
        { sku: 'CERT-ADV', qty: 4, unitPrice: 3_400 },
        { sku: 'BANK-HOURS-100', qty: 1, unitPrice: 14_000 },
      ],
      daysAgo: 25,
      state: 'sent',
    },
    {
      customer: 'La Presse Inc',
      lines: [
        { sku: 'JAMF-MAC-COMM', qty: 6, unitPrice: 5_291.75 },
        { sku: 'BANK-HOURS-100', qty: 5, unitPrice: 14_000 },
        { sku: 'IMPL-FAST', qty: 1, unitPrice: 18_500 },
      ],
      daysAgo: 17,
      state: 'sent',
    },
    {
      customer: 'La Presse Inc',
      lines: [
        { sku: 'JAMF-MAC-COMM', qty: 4, unitPrice: 5_291.75 },
        { sku: 'BANK-HOURS-50', qty: 7, unitPrice: 7_000 },
        { sku: 'ARCH-REVIEW', qty: 2, unitPrice: 9_200 },
        { sku: 'WORKSHOP-DAY', qty: 1, unitPrice: 5_500 },
      ],
      daysAgo: 26,
      state: 'sent',
    },
    {
      customer: 'Centre de Services Scolaire des Découvreurs',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 2, unitPrice: 19_785.75 },
        { sku: 'CERT-FOUND', qty: 6, unitPrice: 1_850 },
        { sku: 'BANK-HOURS-100', qty: 3, unitPrice: 14_000 },
      ],
      daysAgo: 31,
      state: 'sent',
    },
    {
      customer: 'Dublin City Schools',
      lines: [
        { sku: 'JAMF-IOS-EDU', qty: 4, unitPrice: 8_901.3 },
        { sku: 'JAMF-CONNECT-EDU', qty: 3, unitPrice: 8_976 },
        { sku: 'CERT-FOUND', qty: 8, unitPrice: 1_850 },
      ],
      daysAgo: 19,
      state: 'sent',
    },
    {
      customer: 'Nuovo Photography',
      lines: [
        { sku: 'IPAD-PRO', qty: 24, unitPrice: 1_499 },
        { sku: 'JAMF-IOS-EDU', qty: 3, unitPrice: 8_901.3 },
        { sku: 'IMPL-FAST', qty: 1, unitPrice: 18_500 },
      ],
      daysAgo: 14,
      state: 'draft',
    },
    {
      customer: 'Technologies Plotly Inc',
      lines: [
        { sku: 'SAAS-PLAT-STD', qty: 3, unitPrice: 14_500 },
        { sku: 'IMPL-FAST', qty: 1, unitPrice: 18_500 },
        { sku: 'BANK-HOURS-50', qty: 1, unitPrice: 7_000 },
      ],
      daysAgo: 12,
      state: 'sent',
    },
    {
      customer: 'FLORIDA GUL COAST UNIVERSITY',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 1, unitPrice: 19_785.75 },
        { sku: 'JAMF-IOS-EDU', qty: 2, unitPrice: 8_901.3 },
      ],
      daysAgo: 35,
      state: 'draft',
    },
  ];

  for (const b of big) {
    out.push({
      number: `Q-${String(id).padStart(5, '0')}`,
      customerName: b.customer,
      state: b.state,
      lines: b.lines,
      daysAgo: b.daysAgo,
    });
    id += 1;
  }

  // Confirmed sales orders — mirror the screenshot's "Top Sales Orders".
  const orders: Array<{ customer: string; lines: OrderSeedLine[]; daysAgo: number }> = [
    {
      customer: 'FLORIDA GUL COAST UNIVERSITY',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 1, unitPrice: 19_785.75 },
        { sku: 'JAMF-MAC-EDU-CLOUD', qty: 1, unitPrice: 30_632 },
        { sku: 'JAMF-IOS-EDU', qty: 1, unitPrice: 8_901.3 },
        { sku: 'CERT-ADV', qty: 3, unitPrice: 3_400 },
        { sku: 'WORKSHOP-DAY', qty: 1, unitPrice: 5_500 },
      ],
      daysAgo: 28,
    },
    {
      customer: 'Centre de Services Scolaire des Découvreurs',
      lines: [
        { sku: 'JAMF-MAC-EDU', qty: 1, unitPrice: 19_785.75 },
        { sku: 'BANK-HOURS-100', qty: 1, unitPrice: 14_000 },
      ],
      daysAgo: 16,
    },
    {
      customer: 'Cégep de Lanaudière, Guillaume Chartrand',
      lines: [
        { sku: 'CERT-ADV', qty: 2, unitPrice: 3_400 },
        { sku: 'WORKSHOP-DAY', qty: 1, unitPrice: 5_500 },
        { sku: 'CERT-FOUND', qty: 1, unitPrice: 1_850 },
      ],
      daysAgo: 11,
    },
    {
      customer: 'Brilliance Employment & Enterprise Strategy Inc.',
      lines: [{ sku: 'JAMF-MAC-COMM', qty: 1, unitPrice: 5_291.75 }],
      daysAgo: 8,
    },
    {
      customer: 'Softchoice LP',
      lines: [{ sku: 'OCTORY-PRO', qty: 1, unitPrice: 787.64 }],
      daysAgo: 6,
    },
  ];

  for (const o of orders) {
    out.push({
      number: `SO-${String(id).padStart(5, '0')}`,
      customerName: o.customer,
      state: 'confirmed',
      lines: o.lines,
      daysAgo: o.daysAgo,
    });
    id += 1;
  }

  // Fill in remaining quotations across all customers so we hit ~46 quotations
  // (matches the screenshot KPI). Deterministic — same seed every run.
  let i = 0;
  while (id <= 80) {
    const customer = cust(i);
    const sku = fixtureProducts[i % fixtureProducts.length]!.sku;
    const unitPrice = fixtureProducts[i % fixtureProducts.length]!.listPrice;
    const qty = ((i * 7) % 5) + 1;
    const daysAgo = ((i * 11) % 80) + 5;
    const state = (
      i % 13 === 0 ? 'cancelled' : i % 7 === 0 ? 'draft' : 'sent'
    ) as SalesOrderSeed['state'];
    out.push({
      number: `Q-${String(id).padStart(5, '0')}`,
      customerName: customer,
      state,
      lines: [{ sku, qty, unitPrice }],
      daysAgo,
    });
    id += 1;
    i += 1;
  }

  return out;
}

export const fixtureSalesOrders = makeOrders();
