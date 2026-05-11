-- Sprint 23 — Invoicing module.
-- Mirrors Odoo `account.move` (move_type='out_invoice') + `account.payment`.
-- Every table is org-scoped; FKs cascade on org/parent delete; numbers are
-- unique per org so two tenants can both have INV-00001.

-- Invoice lifecycle states.
DO $$ BEGIN
  CREATE TYPE invoice_state AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'bank_transfer',
    'credit_card',
    'cheque',
    'cash',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  state           invoice_state NOT NULL DEFAULT 'draft',
  sales_order_id  UUID REFERENCES sales_orders(id),
  customer_name   TEXT NOT NULL,
  customer_id     UUID,
  salesperson_id  UUID REFERENCES users(id),
  country_code    VARCHAR(2),
  currency        VARCHAR(3) NOT NULL DEFAULT 'CAD',
  total_micros    BIGINT NOT NULL DEFAULT 0,
  paid_micros     BIGINT NOT NULL DEFAULT 0,
  invoice_date    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  due_date        TIMESTAMPTZ(6) NOT NULL,
  paid_at         TIMESTAMPTZ(6),
  notes           TEXT,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_key
  ON invoices(org_id, number);
CREATE INDEX IF NOT EXISTS invoices_org_state_due_idx
  ON invoices(org_id, state, due_date ASC);
CREATE INDEX IF NOT EXISTS invoices_org_customer_idx
  ON invoices(org_id, customer_name);
CREATE INDEX IF NOT EXISTS invoices_org_sales_order_idx
  ON invoices(org_id, sales_order_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES products(id),
  description       TEXT NOT NULL,
  quantity          DECIMAL(12, 3) NOT NULL DEFAULT 1,
  unit_price_micros BIGINT NOT NULL,
  subtotal_micros   BIGINT NOT NULL,
  created_at        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_lines_org_invoice_idx
  ON invoice_lines(org_id, invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_micros BIGINT NOT NULL,
  currency      VARCHAR(3) NOT NULL DEFAULT 'CAD',
  method        payment_method NOT NULL DEFAULT 'bank_transfer',
  reference     TEXT,
  received_at   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_org_invoice_idx
  ON payments(org_id, invoice_id);
CREATE INDEX IF NOT EXISTS payments_org_received_idx
  ON payments(org_id, received_at DESC);
