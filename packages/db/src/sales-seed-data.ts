// Sales module seed fixtures — Sprint 21.
// Mirrors the shape of an Odoo Sales Dashboard so the SalesDashboardPage
// has realistic data on first boot: 6 categories, ~30 products, 20 customers
// across 8 countries with one salesperson each, and ~80 sales orders mixing
// quotations (draft/sent) and confirmed sales orders over a 3-month window.
//
// Money is in **micros** (integer × 1e6) per the rest of BidStack — formatters
// divide back at the edge.
//
// Products, customers, and orders extracted to sub-files (BS-R1).

export type { ProductSeed } from './sales-seed-data.products.js';
export { fixtureProductCategories, fixtureProducts } from './sales-seed-data.products.js';

export type { CustomerSeed } from './sales-seed-data.customers.js';
export { fixtureSalesCustomers } from './sales-seed-data.customers.js';

export type { OrderSeedLine, SalesOrderSeed } from './sales-seed-data.orders.js';
export { fixtureSalesOrders } from './sales-seed-data.orders.js';
