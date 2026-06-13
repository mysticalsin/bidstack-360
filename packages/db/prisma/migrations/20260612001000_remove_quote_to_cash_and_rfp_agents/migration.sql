-- DropForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "agents" DROP CONSTRAINT "agents_org_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_org_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_product_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_company_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_org_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_sales_order_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_salesperson_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_org_id_fkey";

-- DropForeignKey
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_org_id_fkey";

-- DropForeignKey
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_org_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_org_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_versions" DROP CONSTRAINT "quote_versions_org_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_versions" DROP CONSTRAINT "quote_versions_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_agent_assignments" DROP CONSTRAINT "rfp_agent_assignments_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_agent_assignments" DROP CONSTRAINT "rfp_agent_assignments_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_order_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_product_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_company_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_salesperson_id_fkey";

-- DropTable
DROP TABLE "agent_runs";

-- DropTable
DROP TABLE "agents";

-- DropTable
DROP TABLE "invoice_lines";

-- DropTable
DROP TABLE "invoices";

-- DropTable
DROP TABLE "payments";

-- DropTable
DROP TABLE "product_categories";

-- DropTable
DROP TABLE "products";

-- DropTable
DROP TABLE "quote_lines";

-- DropTable
DROP TABLE "quote_versions";

-- DropTable
DROP TABLE "quotes";

-- DropTable
DROP TABLE "rfp_agent_assignments";

-- DropTable
DROP TABLE "sales_order_lines";

-- DropTable
DROP TABLE "sales_orders";

-- DropEnum
DROP TYPE "agent_run_status";

-- DropEnum
DROP TYPE "agent_status";

-- DropEnum
DROP TYPE "invoice_state";

-- DropEnum
DROP TYPE "order_state";

-- DropEnum
DROP TYPE "payment_method";

-- DropEnum
DROP TYPE "quote_state";

