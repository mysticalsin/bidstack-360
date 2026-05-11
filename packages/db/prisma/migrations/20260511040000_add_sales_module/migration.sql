-- BidStack 360° — Sprint 21: Sales module
-- Adds Odoo-style Quotations/Orders/Products/Categories/Lines. Mirrors the
-- schema_prisma additions in this same sprint. Written by hand because
-- Prisma migrate locks the engine DLL on Windows during dev (see MISTAKES.md
-- entry: "Prisma Windows DLL file locking").

-- ───────────────────────────── Enums ─────────────────────────────────────
CREATE TYPE "order_state" AS ENUM ('draft', 'sent', 'confirmed', 'done', 'cancelled');

-- ─────────────────────────── product_categories ──────────────────────────
CREATE TABLE "product_categories" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID         NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "name"       TEXT         NOT NULL,
  "parent_id"  UUID         REFERENCES "product_categories"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "product_categories_org_name_key"   ON "product_categories" ("org_id", "name");
CREATE        INDEX "product_categories_org_parent_idx" ON "product_categories" ("org_id", "parent_id");

-- ─────────────────────────────── products ────────────────────────────────
CREATE TABLE "products" (
  "id"                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID           NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "sku"               TEXT           NOT NULL,
  "name"              TEXT           NOT NULL,
  "category_id"       UUID           REFERENCES "product_categories"("id") ON DELETE SET NULL,
  "list_price_micros" BIGINT         NOT NULL DEFAULT 0,
  "currency"          VARCHAR(3)     NOT NULL DEFAULT 'CAD',
  "active"            BOOLEAN        NOT NULL DEFAULT TRUE,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "products_org_sku_key"      ON "products" ("org_id", "sku");
CREATE        INDEX "products_org_name_idx"     ON "products" ("org_id", "name");
CREATE        INDEX "products_org_category_idx" ON "products" ("org_id", "category_id");

-- ───────────────────────────── sales_orders ──────────────────────────────
CREATE TABLE "sales_orders" (
  "id"             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID           NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "number"         TEXT           NOT NULL,
  "state"          "order_state"  NOT NULL DEFAULT 'draft',
  "customer_name"  TEXT           NOT NULL,
  "customer_id"    UUID,
  "salesperson_id" UUID           REFERENCES "users"("id") ON DELETE SET NULL,
  "country_code"   VARCHAR(2),
  "currency"       VARCHAR(3)     NOT NULL DEFAULT 'CAD',
  "total_micros"   BIGINT         NOT NULL DEFAULT 0,
  "order_date"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "confirmed_at"   TIMESTAMPTZ(6),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "sales_orders_org_number_key"         ON "sales_orders" ("org_id", "number");
CREATE        INDEX "sales_orders_org_state_date_idx"     ON "sales_orders" ("org_id", "state", "order_date" DESC);
CREATE        INDEX "sales_orders_org_country_idx"        ON "sales_orders" ("org_id", "country_code");
CREATE        INDEX "sales_orders_org_customer_idx"       ON "sales_orders" ("org_id", "customer_name");
CREATE        INDEX "sales_orders_org_salesperson_idx"    ON "sales_orders" ("org_id", "salesperson_id");

-- ──────────────────────────── sales_order_lines ──────────────────────────
CREATE TABLE "sales_order_lines" (
  "id"                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID           NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "order_id"          UUID           NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "product_id"        UUID           NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
  "description"       TEXT           NOT NULL,
  "quantity"          DECIMAL(12, 3) NOT NULL DEFAULT 1,
  "unit_price_micros" BIGINT         NOT NULL,
  "subtotal_micros"   BIGINT         NOT NULL,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX "sales_order_lines_org_order_idx"   ON "sales_order_lines" ("org_id", "order_id");
CREATE INDEX "sales_order_lines_org_product_idx" ON "sales_order_lines" ("org_id", "product_id");
