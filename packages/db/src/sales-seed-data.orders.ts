/**
 * sales-seed-data.orders.ts — order line types and sales order fixtures.
 *
 * Extracted from sales-seed-data.ts (BS-R1 file-size refactor).
 * Re-exported from sales-seed-data.ts — import from there, not here.
 */

import { fixtureSalesCustomers } from './sales-seed-data.customers.js';
import { fixtureProducts } from './sales-seed-data.products.js';

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
