/**
 * sales-intelligence.charts.ts — Monthly, country, and product chart builders.
 *
 * WHY separate: these five builders share the same bucket-aggregate-sort pattern
 * and have no dependency on Prisma or Fastify. Extracting them keeps the service
 * module focused on DB access and orchestration, and every file under 400 lines.
 *
 * Import DAG: helpers (leaf) ← this file ← service.ts
 */
import type {
  CategorySalesRow,
  CountrySalesPerson,
  CountrySalesRow,
  MonthlySalesPoint,
  ProductSalesRow,
  SalesRankRow,
} from '@bidstack/shared';
import { pct } from '@bidstack/shared';

import {
  COUNTRY_META,
  ORDER_STATES,
  classifyProduct,
  customerCountry,
  sumMicros,
} from './sales-intelligence.helpers.js';

/* ─── Monthly sales ─── */

export function buildMonthlySales(rows: SalesRankRow[]): MonthlySalesPoint[] {
  const buckets = new Map<string, MonthlySalesPoint>();
  for (const row of rows) {
    const date = row.date ? new Date(row.date) : new Date();
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const existing =
      buckets.get(month) ??
      ({
        month,
        label: date.toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        revenueMicros: 0,
        quotationCount: 0,
        orderCount: 0,
      } satisfies MonthlySalesPoint);
    existing.revenueMicros += row.revenueMicros;
    if (ORDER_STATES.has(row.state)) existing.orderCount += 1;
    else if (row.state !== 'closed_lost' && row.state !== 'cancelled') existing.quotationCount += 1;
    buckets.set(month, existing);
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-8);
}

/* ─── Country breakdown ─── */

export function buildCountryRows(
  rows: SalesRankRow[],
  contacts: Array<{ customer: string; name: string; role: string | null; email: string | null }>,
): CountrySalesRow[] {
  const totalRevenue = Math.max(sumMicros(rows), 1);
  const contactsByCustomer = new Map<string, CountrySalesPerson[]>();
  for (const contact of contacts) {
    const people = contactsByCustomer.get(contact.customer) ?? [];
    people.push({
      name: contact.name,
      title: contact.role,
      email: contact.email,
      customer: contact.customer,
    });
    contactsByCustomer.set(contact.customer, people);
  }

  const buckets = new Map<
    string,
    {
      revenueMicros: number;
      quotationCount: number;
      orderCount: number;
      customers: Set<string>;
      people: Map<string, CountrySalesPerson>;
      salespeople: Set<string>;
    }
  >();

  for (const row of rows) {
    const code = row.countryCode ?? customerCountry(row.customer);
    if (!code) continue;
    const bucket = buckets.get(code) ?? {
      revenueMicros: 0,
      quotationCount: 0,
      orderCount: 0,
      customers: new Set<string>(),
      people: new Map<string, CountrySalesPerson>(),
      salespeople: new Set<string>(),
    };
    bucket.revenueMicros += row.revenueMicros;
    bucket.customers.add(row.customer);
    if (ORDER_STATES.has(row.state)) bucket.orderCount += 1;
    else if (row.state !== 'closed_lost' && row.state !== 'cancelled') bucket.quotationCount += 1;
    if (row.salesperson) bucket.salespeople.add(row.salesperson);
    for (const person of contactsByCustomer.get(row.customer) ?? []) {
      bucket.people.set(`${person.customer}:${person.email ?? person.name}`, person);
    }
    buckets.set(code, bucket);
  }

  return [...buckets.entries()]
    .map(([countryCode, bucket]) => {
      const topCustomers = [...bucket.customers].slice(0, 4);
      const salespeople = [...bucket.salespeople].slice(0, 4);
      const contactPeople = [...bucket.people.values()].sort(
        (a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name),
      );
      const salespersonPeople = salespeople.map<CountrySalesPerson>((name, index) => ({
        name,
        title: 'Sales owner',
        email: null,
        customer: topCustomers[index % Math.max(topCustomers.length, 1)] ?? 'Country portfolio',
      }));
      const people = mergePeople(contactPeople, salespersonPeople).slice(0, 5);

      return {
        countryCode,
        countryName: COUNTRY_META[countryCode]?.name ?? countryCode,
        revenueMicros: bucket.revenueMicros,
        quotationCount: bucket.quotationCount,
        orderCount: bucket.orderCount,
        customerCount: bucket.customers.size,
        topCustomers,
        people,
        salespeople,
        sharePct: pct(bucket.revenueMicros, totalRevenue),
      };
    })
    .sort((a, b) => b.revenueMicros - a.revenueMicros)
    .slice(0, 10);
}

// Private — only used within buildCountryRows above.
function mergePeople(
  contacts: CountrySalesPerson[],
  salespeople: CountrySalesPerson[],
): CountrySalesPerson[] {
  const seen = new Set<string>();
  const merged: CountrySalesPerson[] = [];
  for (const person of [...contacts, ...salespeople]) {
    const key = `${person.customer}:${person.email ?? person.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(person);
  }
  return merged;
}

/* ─── Product / category rows ─── */

export function buildOpportunityProductRows(
  opportunities: Array<{
    name: string;
    industry: string | null;
    stage: string;
    valueMicros: bigint | number | unknown;
  }>,
  currencyCode: string,
): ProductSalesRow[] {
  const buckets = new Map<string, ProductSalesRow>();
  for (const opp of opportunities) {
    if (opp.stage === 'closed_lost') continue;
    const product = classifyProduct(opp.name, opp.industry);
    const existing =
      buckets.get(product.product) ??
      ({
        product: product.product,
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
      } satisfies ProductSalesRow);
    existing.orderCount += 1;
    existing.revenueMicros += Math.max(0, Math.round(Number(opp.valueMicros ?? 0)));
    buckets.set(product.product, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros).slice(0, 10);
}

export function buildProductRowsFromSales(
  rows: SalesRankRow[],
  currencyCode: string,
): ProductSalesRow[] {
  const buckets = new Map<string, ProductSalesRow>();
  for (const row of rows) {
    if (row.state === 'cancelled') continue;
    const product = classifyProduct(row.customer, null);
    const existing =
      buckets.get(product.product) ??
      ({
        product: product.product,
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
      } satisfies ProductSalesRow);
    existing.orderCount += 1;
    existing.revenueMicros += row.revenueMicros;
    buckets.set(product.product, existing);
  }
  return [...buckets.values()].sort((a, b) => b.revenueMicros - a.revenueMicros).slice(0, 10);
}

export function buildCategoryRowsFromProducts(
  products: ProductSalesRow[],
  currencyCode: string,
): CategorySalesRow[] {
  const total = products.reduce((sum, row) => sum + row.revenueMicros, 0);
  const buckets = new Map<string, CategorySalesRow>();
  for (const product of products) {
    const existing =
      buckets.get(product.category) ??
      ({
        category: product.category,
        orderCount: 0,
        revenueMicros: 0,
        currencyCode,
        sharePct: 0,
      } satisfies CategorySalesRow);
    existing.orderCount += product.orderCount;
    existing.revenueMicros += product.revenueMicros;
    buckets.set(product.category, existing);
  }
  return [...buckets.values()]
    .map((row) => ({ ...row, sharePct: pct(row.revenueMicros, total) }))
    .sort((a, b) => b.revenueMicros - a.revenueMicros)
    .slice(0, 10);
}
