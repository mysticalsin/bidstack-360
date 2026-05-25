-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted');

-- CreateEnum
CREATE TYPE "lead_priority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "proposal_status" AS ENUM ('draft', 'review', 'approved', 'submitted', 'won', 'lost');

-- CreateEnum
CREATE TYPE "activity_actor_type" AS ENUM ('user', 'system', 'agent');

-- CreateEnum
CREATE TYPE "migration_source" AS ENUM ('SALESFORCE_CSV', 'HUBSPOT_OAUTH', 'CSV');

-- CreateEnum
CREATE TYPE "migration_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "workflow_trigger_kind" AS ENUM ('record_created', 'record_updated', 'stage_changed', 'schedule', 'webhook_received', 'manual');

-- CreateEnum
CREATE TYPE "workflow_action_kind" AS ENUM ('send_email', 'send_slack', 'create_task', 'update_field', 'call_webhook', 'assign_owner', 'run_dust_agent', 'create_notification');

-- CreateEnum
CREATE TYPE "case_priority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "case_status" AS ENUM ('new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'escalated');

-- CreateEnum
CREATE TYPE "quote_state" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('microsoft_graph', 'google_workspace', 'gmail', 'slack', 'twilio');

-- CreateEnum
CREATE TYPE "integration_token_status" AS ENUM ('active', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "sync_state" AS ENUM ('PENDING_PUSH', 'SYNCED', 'CONFLICT', 'DELETED_REMOTE');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('CONFIRMED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ai_assistant_kind" AS ENUM ('EMAIL_DRAFT', 'DEAL_INSIGHT', 'MEETING_PREP', 'DATA_ENRICH', 'SENTIMENT');

-- CreateEnum
CREATE TYPE "email_provider" AS ENUM ('GMAIL', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "sms_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNDELIVERED');

-- CreateEnum
CREATE TYPE "sms_consent_source" AS ENUM ('USER_REQUEST', 'STOP_KEYWORD', 'MANUAL');

-- CreateEnum
CREATE TYPE "sms_entity_type" AS ENUM ('CONTACT', 'LEAD');

-- CreateEnum
CREATE TYPE "saved_view_entity" AS ENUM ('OPPORTUNITY', 'CONTACT', 'LEAD', 'COMPANY', 'TASK');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'CHURNED', 'PAUSED');

-- CreateEnum
CREATE TYPE "renewal_opportunity_status" AS ENUM ('UPCOMING', 'ENGAGED', 'AT_RISK', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "health_trend" AS ENUM ('IMPROVING', 'STABLE', 'DECLINING');

-- CreateEnum
CREATE TYPE "nps_category" AS ENUM ('PROMOTER', 'PASSIVE', 'DETRACTOR');

-- CreateEnum
CREATE TYPE "churn_signal_kind" AS ENUM ('LOW_USAGE', 'SUPPORT_VOLUME_SPIKE', 'CHAMPION_DEPARTED', 'COMPETITOR_MENTION', 'FEATURE_REQUEST_UNRESOLVED', 'EXEC_SPONSOR_LOST');

-- CreateEnum
CREATE TYPE "churn_signal_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "expansion_kind" AS ENUM ('UPSELL', 'CROSS_SELL', 'SEAT_EXPANSION', 'FEATURE_UPSELL', 'RENEWAL_UPLIFT');

-- CreateEnum
CREATE TYPE "expansion_status" AS ENUM ('IDENTIFIED', 'ENGAGED', 'PROPOSED', 'WON', 'LOST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "activity_type" ADD VALUE 'stage_change';
ALTER TYPE "activity_type" ADD VALUE 'field_edit';
ALTER TYPE "activity_type" ADD VALUE 'file_upload';
ALTER TYPE "activity_type" ADD VALUE 'task_completed';
ALTER TYPE "activity_type" ADD VALUE 'email_opened';
ALTER TYPE "activity_type" ADD VALUE 'email_clicked';
ALTER TYPE "activity_type" ADD VALUE 'cadence_started';
ALTER TYPE "activity_type" ADD VALUE 'cadence_completed';
ALTER TYPE "activity_type" ADD VALUE 'custom';

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_org_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_product_id_fkey";

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
ALTER TABLE "proposal_documents" DROP CONSTRAINT "proposal_documents_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_order_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_product_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_org_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_salesperson_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_exports" DROP CONSTRAINT "tenant_exports_requested_by_id_fkey";

-- DropIndex
DROP INDEX "activities_org_entity_idx";

-- DropIndex
DROP INDEX "companies_parent_id_idx";

-- DropIndex
DROP INDEX "roles_org_id_idx";

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "actor_id" UUID,
ADD COLUMN     "actor_type" "activity_actor_type" NOT NULL DEFAULT 'user',
ADD COLUMN     "body" JSONB DEFAULT '{}',
ADD COLUMN     "idempotency_key" VARCHAR(128),
ADD COLUMN     "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "activity_attendees" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "agent_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_insights" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "approval_gates" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bid_documents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bid_opportunities" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "bid_scores" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "criteria" DROP DEFAULT,
ALTER COLUMN "category_scores" DROP DEFAULT,
ALTER COLUMN "memos_policies" DROP DEFAULT;

-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_enrichments" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "compliance_checks" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "compliance_matrix_rows" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "ai_opt_out" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "dashboard_widgets" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "document_extractions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "dust_run_id" SET DATA TYPE TEXT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "dust_runs" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "file_attachments" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "integration_configs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "billing_address" JSONB,
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "discount_micros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "purchase_order_number" VARCHAR(100),
ADD COLUMN     "shipping_address" JSONB,
ADD COLUMN     "shipping_micros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal_micros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tax_micros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" DECIMAL(5,4),
ADD COLUMN     "terms" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "memos_policies" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "evidence" DROP DEFAULT,
ALTER COLUMN "source_traces" DROP DEFAULT;

-- AlterTable
ALTER TABLE "memos_traces" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "memos_world_models" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "value" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "dust_doc_id" TEXT;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "country" VARCHAR(2),
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "dust_last_pushed_at" TIMESTAMPTZ(6),
ADD COLUMN     "pipeline_stage_id" UUID,
ADD COLUMN     "territory_id" UUID,
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "permissions" DROP COLUMN "created_at",
DROP COLUMN "module",
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "provider_health" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "queue_health" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "references" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "release_scores" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "requirements" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "review_issues" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "risk_register_items" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "updated_at",
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales_order_lines" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "source_chunks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "submission_packages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sync_events" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "tenant_exports" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "webhook_subscriptions" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_delivery_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_failure_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "workflow_actions" DROP COLUMN "kind",
ADD COLUMN     "kind" "workflow_action_kind" NOT NULL,
ALTER COLUMN "config" SET NOT NULL,
ALTER COLUMN "org_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflows" DROP COLUMN "trigger_kind",
ADD COLUMN     "trigger_kind" "workflow_trigger_kind" NOT NULL,
ALTER COLUMN "trigger_config" SET NOT NULL;

-- DropTable
DROP TABLE "proposal_documents";

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL,
    "duration_ms" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "name" TEXT NOT NULL,
    "status" "proposal_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_id" UUID,
    "compliance_score" INTEGER,
    "due_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_sections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "ai_drafted" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "proposal_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_solutions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'active',
    "extracted_from_document_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "confidence_bps" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_products" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "price_range_micros" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'active',
    "extracted_from_document_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "confidence_bps" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "migration_source" NOT NULL,
    "status" "migration_status" NOT NULL DEFAULT 'PENDING',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error_summary" JSONB NOT NULL DEFAULT '[]',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "undoable_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "migration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_mappings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source" "migration_source" NOT NULL,
    "source_entity" TEXT NOT NULL,
    "mappings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "migration_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictive_scores" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence_bps" INTEGER NOT NULL DEFAULT 5000,
    "features" JSONB NOT NULL DEFAULT '{}',
    "model_version" TEXT NOT NULL,
    "recommended_action" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "predictive_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictive_models" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "accuracy_metrics" JSONB NOT NULL DEFAULT '{}',
    "trained_at" TIMESTAMPTZ(6) NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "model_artifact_s3_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictive_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger_record_type" TEXT,
    "trigger_record_id" UUID,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body_md" TEXT NOT NULL,
    "parent_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_presence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "current_record_type" TEXT,
    "current_record_id" UUID,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_edit_locks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entity_edit_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_cases" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "priority" "case_priority" NOT NULL DEFAULT 'medium',
    "status" "case_status" NOT NULL DEFAULT 'new',
    "account_id" UUID,
    "company_id" UUID,
    "contact_id" UUID,
    "owner_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'web',
    "satisfaction" INTEGER,
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "sla_deadline" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "service_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company_name" TEXT NOT NULL,
    "company_id" UUID,
    "title" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "status" "lead_status" NOT NULL DEFAULT 'new',
    "score" INTEGER NOT NULL DEFAULT 0,
    "priority" "lead_priority" NOT NULL DEFAULT 'medium',
    "owner_id" UUID,
    "budget" TEXT,
    "authority" TEXT,
    "need" TEXT,
    "timeline" TEXT,
    "converted_to_opportunity_id" UUID,
    "converted_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "intel" JSONB,
    "dust_doc_id" TEXT,
    "dust_last_pushed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_contacts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'stakeholder',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "influence" INTEGER,
    "sentiment" "sentiment",
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "opportunity_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_settings" (
    "org_id" UUID NOT NULL,
    "default_currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "date_format" TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV-',
    "invoice_net_days" INTEGER NOT NULL DEFAULT 30,
    "tax_rate_default" DECIMAL(5,4),
    "company_address" JSONB,
    "email_from_name" TEXT,
    "email_from_address" CITEXT,
    "pipeline_stages" JSONB NOT NULL DEFAULT '[]',
    "notification_prefs" JSONB NOT NULL DEFAULT '{}',
    "ai_cost_cap_daily_micros" BIGINT NOT NULL DEFAULT 5000000,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "territories" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_codes" TEXT[],
    "region" TEXT,
    "postal_codes" TEXT[],
    "owner_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_routing_rules" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "assign_to_user_id" UUID,
    "assign_to_territory_id" UUID,
    "round_robin_team" TEXT[],
    "round_robin_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lead_routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecasts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'pipeline',
    "amount_micros" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "manifest_url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "permissions" TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_command_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "transcript" TEXT NOT NULL,
    "intent" TEXT NOT NULL DEFAULT 'unknown',
    "entities" JSONB NOT NULL DEFAULT '{}',
    "action_taken" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "voice_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" BIGSERIAL NOT NULL,
    "org_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "options" JSONB DEFAULT '[]',
    "default_value" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "custom_object_def_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "account_id" UUID,
    "owner_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" "quote_state" NOT NULL DEFAULT 'draft',
    "number" TEXT,
    "total_micros" BIGINT NOT NULL DEFAULT 0,
    "tax_micros" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "valid_until" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6),
    "terms" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "product_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unit_price_micros" BIGINT NOT NULL,
    "discount_pct" DECIMAL(5,2),
    "line_total_micros" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "probability" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "forecast_category" TEXT NOT NULL DEFAULT 'pipeline',
    "is_won" BOOLEAN NOT NULL DEFAULT false,
    "is_lost" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_tokens" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "last_refreshed_at" TIMESTAMPTZ(6),
    "status" "integration_token_status" NOT NULL DEFAULT 'active',
    "error_message" TEXT,
    "external_account_id" TEXT,
    "external_account_email" TEXT,
    "delta_state" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "external_id" TEXT,
    "provider" "integration_provider" NOT NULL,
    "subject" TEXT NOT NULL,
    "body_preview" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "location" TEXT,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "organizer_email" TEXT,
    "related_entity_type" TEXT,
    "related_entity_id" UUID,
    "external_updated_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6),
    "etag" TEXT,
    "sync_state" "sync_state" NOT NULL DEFAULT 'SYNCED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_pages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_notice_hours" INTEGER NOT NULL DEFAULT 2,
    "max_advance_days" INTEGER NOT NULL DEFAULT 60,
    "availability_rules" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "custom_questions" JSONB NOT NULL DEFAULT '[]',
    "redirect_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "booking_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "booking_page_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "attendee_name" TEXT NOT NULL,
    "attendee_email" CITEXT NOT NULL,
    "attendee_phone" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" "booking_status" NOT NULL DEFAULT 'CONFIRMED',
    "cancel_token" UUID NOT NULL,
    "calendar_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ai_assistant_kind" NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "token_input" INTEGER NOT NULL,
    "token_output" INTEGER NOT NULL,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_feedback" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" "ai_assistant_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "integration_token_id" UUID NOT NULL,
    "provider" "email_provider" NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "from_email" CITEXT NOT NULL,
    "to_emails" JSONB NOT NULL DEFAULT '[]',
    "cc_emails" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT,
    "body_html" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "is_outbound" BOOLEAN NOT NULL DEFAULT true,
    "opened_at" TIMESTAMPTZ(6),
    "clicked_at" TIMESTAMPTZ(6),
    "entity_type" VARCHAR(32),
    "entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tracking_pixels" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email_message_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ(6),
    "first_opened_ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tracking_pixels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_workspaces" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "integration_token_id" UUID NOT NULL,
    "slack_team_id" VARCHAR(32) NOT NULL,
    "team_name" TEXT NOT NULL,
    "bot_user_id" VARCHAR(32) NOT NULL,
    "bot_scopes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slack_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_channels" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "slack_workspace_id" UUID,
    "integration_token_id" UUID NOT NULL,
    "channel_id" VARCHAR(32) NOT NULL,
    "channel_name" TEXT NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_member" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_user_mappings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "slack_user_id" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slack_user_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zapier_apps" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "api_key_hash" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'BidStack Zapier App',
    "scopes" JSONB NOT NULL DEFAULT '["read","write"]',
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zapier_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zapier_triggers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "zapier_app_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zapier_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zapier_actions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "zapier_app_id" UUID NOT NULL,
    "action_type" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zapier_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zapier_subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "zapier_app_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "target_url" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zapier_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "integration_token_id" UUID NOT NULL,
    "subscription_id" VARCHAR(64) NOT NULL,
    "resource" VARCHAR(128) NOT NULL,
    "change_type" VARCHAR(64) NOT NULL,
    "client_state" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "renewal_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "graph_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_object_defs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label_singular" VARCHAR(128) NOT NULL,
    "label_plural" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "icon" VARCHAR(64) NOT NULL DEFAULT 'box',
    "color" VARCHAR(16) NOT NULL DEFAULT '#6366f1',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_object_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_object_records" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "custom_object_def_id" UUID NOT NULL,
    "record_key" VARCHAR(32) NOT NULL,
    "values_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "custom_object_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_object_relations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "custom_object_def_id" UUID NOT NULL,
    "relation_key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "related_entity_type" VARCHAR(64) NOT NULL,
    "cardinality" VARCHAR(16) NOT NULL DEFAULT 'ONE_TO_MANY',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "junction_table_schema" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_object_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "integration_token_id" UUID NOT NULL,
    "from_number" VARCHAR(32) NOT NULL,
    "to_number" VARCHAR(32) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "sms_status" NOT NULL DEFAULT 'QUEUED',
    "twilio_sid" VARCHAR(64),
    "error_code" INTEGER,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "cost_micros" BIGINT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "entity_type" "sms_entity_type",
    "entity_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_consents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "phone_number" VARCHAR(32) NOT NULL,
    "opted_out" BOOLEAN NOT NULL DEFAULT false,
    "opted_out_at" TIMESTAMPTZ(6),
    "source" "sms_consent_source" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity" "saved_view_entity" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "sort" JSONB,
    "columns" JSONB,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "native_push_tokens" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "token" VARCHAR(256) NOT NULL,
    "provider" VARCHAR(16) NOT NULL DEFAULT 'EXPO',
    "platform" VARCHAR(16) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "external_meeting_id" VARCHAR(256),
    "join_url" VARCHAR(2048),
    "host_join_url" VARCHAR(2048),
    "scheduled_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "duration_sec" INTEGER,
    "participant_emails" JSONB,
    "recording_url" VARCHAR(2048),
    "transcript_text" TEXT,
    "transcript_structured" JSONB,
    "summary" TEXT,
    "action_items" JSONB,
    "sentiment_score" DOUBLE PRECISION,
    "talk_ratio" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_summaries" (
    "id" UUID NOT NULL,
    "call_session_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source_quote_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "org_id" UUID NOT NULL,

    CONSTRAINT "call_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "product_id" UUID,
    "plan_tier" VARCHAR(64) NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "arr_amount_micros" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "renewal_date" TIMESTAMPTZ(6) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "churn_reason" JSONB,
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_opportunities" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "status" "renewal_opportunity_status" NOT NULL DEFAULT 'UPCOMING',
    "days_out_trigger" INTEGER NOT NULL,
    "owner_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "renewal_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_scores" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '{}',
    "trend" "health_trend" NOT NULL DEFAULT 'STABLE',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nps_surveys" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "contact_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "score" INTEGER,
    "score_11" INTEGER,
    "feedback" TEXT,
    "category" "nps_category",
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "nps_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "churn_signals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "churn_signal_kind" NOT NULL,
    "severity" "churn_signal_severity" NOT NULL DEFAULT 'MEDIUM',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "resolution" TEXT,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "churn_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expansion_opportunities" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" "expansion_kind" NOT NULL,
    "value_micros" BIGINT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "status" "expansion_status" NOT NULL DEFAULT 'IDENTIFIED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "expansion_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yjs_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID NOT NULL,
    "field_key" VARCHAR(128) NOT NULL,
    "ydoc_binary" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "yjs_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yjs_updates" (
    "id" UUID NOT NULL,
    "ydoc_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "client_id" VARCHAR(256) NOT NULL,
    "update" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "yjs_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscription_id_created_at_idx" ON "webhook_deliveries"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_org_id_idx" ON "webhook_deliveries"("org_id");

-- CreateIndex
CREATE INDEX "proposals_org_status_idx" ON "proposals"("org_id", "status");

-- CreateIndex
CREATE INDEX "proposals_org_opp_idx" ON "proposals"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "proposals_deleted_at_idx" ON "proposals"("deleted_at");

-- CreateIndex
CREATE INDEX "proposal_sections_org_id_proposal_id_idx" ON "proposal_sections"("org_id", "proposal_id");

-- CreateIndex
CREATE INDEX "proposal_sections_deleted_at_idx" ON "proposal_sections"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_sections_proposal_id_key_key" ON "proposal_sections"("proposal_id", "key");

-- CreateIndex
CREATE INDEX "account_solutions_org_account_status_idx" ON "account_solutions"("org_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "account_solutions_org_id_company_id_idx" ON "account_solutions"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "account_solutions_deleted_at_idx" ON "account_solutions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_solutions_org_account_name_key" ON "account_solutions"("org_id", "account_id", "name");

-- CreateIndex
CREATE INDEX "account_products_org_account_status_idx" ON "account_products"("org_id", "account_id", "status");

-- CreateIndex
CREATE INDEX "account_products_org_id_company_id_idx" ON "account_products"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "account_products_deleted_at_idx" ON "account_products"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_products_org_account_name_key" ON "account_products"("org_id", "account_id", "name");

-- CreateIndex
CREATE INDEX "migration_jobs_org_id_status_idx" ON "migration_jobs"("org_id", "status");

-- CreateIndex
CREATE INDEX "migration_jobs_org_id_created_at_idx" ON "migration_jobs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "migration_mappings_org_id_source_idx" ON "migration_mappings"("org_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "migration_mappings_org_source_entity_key" ON "migration_mappings"("org_id", "source", "source_entity");

-- CreateIndex
CREATE INDEX "predictive_scores_org_target_idx" ON "predictive_scores"("org_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "predictive_scores_org_kind_score_idx" ON "predictive_scores"("org_id", "kind", "score" DESC);

-- CreateIndex
CREATE INDEX "predictive_scores_org_expires_idx" ON "predictive_scores"("org_id", "expires_at");

-- CreateIndex
CREATE INDEX "predictive_scores_deleted_at_idx" ON "predictive_scores"("deleted_at");

-- CreateIndex
CREATE INDEX "predictive_models_org_entity_active_idx" ON "predictive_models"("org_id", "entity_type", "is_active");

-- CreateIndex
CREATE INDEX "predictive_models_org_entity_version_idx" ON "predictive_models"("org_id", "entity_type", "version" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_org_workflow_idx" ON "workflow_runs"("org_id", "workflow_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_org_status_idx" ON "workflow_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_deleted_at_idx" ON "workflow_runs"("deleted_at");

-- CreateIndex
CREATE INDEX "comments_org_target_created_idx" ON "comments"("org_id", "target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "comments_deleted_at_idx" ON "comments"("deleted_at");

-- CreateIndex
CREATE INDEX "mentions_org_user_read_idx" ON "mentions"("org_id", "user_id", "read_at");

-- CreateIndex
CREATE INDEX "mentions_deleted_at_idx" ON "mentions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_presence_user_id_key" ON "user_presence"("user_id");

-- CreateIndex
CREATE INDEX "user_presence_org_status_idx" ON "user_presence"("org_id", "status");

-- CreateIndex
CREATE INDEX "user_presence_org_record_idx" ON "user_presence"("org_id", "current_record_type", "current_record_id");

-- CreateIndex
CREATE INDEX "user_presence_deleted_at_idx" ON "user_presence"("deleted_at");

-- CreateIndex
CREATE INDEX "entity_edit_locks_org_id_idx" ON "entity_edit_locks"("org_id");

-- CreateIndex
CREATE INDEX "entity_edit_locks_expires_at_idx" ON "entity_edit_locks"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "entity_edit_locks_entity_type_entity_id_key" ON "entity_edit_locks"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "service_cases_org_status_priority_idx" ON "service_cases"("org_id", "status", "priority");

-- CreateIndex
CREATE INDEX "service_cases_org_owner_idx" ON "service_cases"("org_id", "owner_id");

-- CreateIndex
CREATE INDEX "service_cases_org_sla_idx" ON "service_cases"("org_id", "sla_deadline");

-- CreateIndex
CREATE INDEX "service_cases_org_id_company_id_idx" ON "service_cases"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "service_cases_deleted_at_idx" ON "service_cases"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_cases_org_number_key" ON "service_cases"("org_id", "number");

-- CreateIndex
CREATE INDEX "leads_org_id_status_idx" ON "leads"("org_id", "status");

-- CreateIndex
CREATE INDEX "leads_org_id_owner_id_idx" ON "leads"("org_id", "owner_id");

-- CreateIndex
CREATE INDEX "leads_org_id_score_idx" ON "leads"("org_id", "score");

-- CreateIndex
CREATE INDEX "leads_org_id_source_idx" ON "leads"("org_id", "source");

-- CreateIndex
CREATE INDEX "leads_org_id_created_at_idx" ON "leads"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_org_id_priority_idx" ON "leads"("org_id", "priority");

-- CreateIndex
CREATE INDEX "leads_org_id_company_id_idx" ON "leads"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "leads"("deleted_at");

-- CreateIndex
CREATE INDEX "opportunity_contacts_org_id_opportunity_id_idx" ON "opportunity_contacts"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "opportunity_contacts_org_id_contact_id_idx" ON "opportunity_contacts"("org_id", "contact_id");

-- CreateIndex
CREATE INDEX "opportunity_contacts_deleted_at_idx" ON "opportunity_contacts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_contacts_org_id_opportunity_id_contact_id_key" ON "opportunity_contacts"("org_id", "opportunity_id", "contact_id");

-- CreateIndex
CREATE INDEX "org_settings_deleted_at_idx" ON "org_settings"("deleted_at");

-- CreateIndex
CREATE INDEX "territories_org_active_idx" ON "territories"("org_id", "active");

-- CreateIndex
CREATE INDEX "territories_deleted_at_idx" ON "territories"("deleted_at");

-- CreateIndex
CREATE INDEX "lead_rules_org_active_priority_idx" ON "lead_routing_rules"("org_id", "active", "priority" DESC);

-- CreateIndex
CREATE INDEX "lead_routing_rules_deleted_at_idx" ON "lead_routing_rules"("deleted_at");

-- CreateIndex
CREATE INDEX "forecasts_org_period_idx" ON "forecasts"("org_id", "period");

-- CreateIndex
CREATE INDEX "forecasts_deleted_at_idx" ON "forecasts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "forecasts_org_owner_period_cat_key" ON "forecasts"("org_id", "owner_id", "period", "category");

-- CreateIndex
CREATE INDEX "plugins_deleted_at_idx" ON "plugins"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "plugins_org_manifest_key" ON "plugins"("org_id", "manifest_url");

-- CreateIndex
CREATE INDEX "voice_commands_org_user_idx" ON "voice_command_logs"("org_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "voice_command_logs_deleted_at_idx" ON "voice_command_logs"("deleted_at");

-- CreateIndex
CREATE INDEX "sub_events_org_channel_idx" ON "subscription_events"("org_id", "channel", "created_at" DESC);

-- CreateIndex
CREATE INDEX "subscription_events_deleted_at_idx" ON "subscription_events"("deleted_at");

-- CreateIndex
CREATE INDEX "custom_field_definitions_org_id_entity_type_active_idx" ON "custom_field_definitions"("org_id", "entity_type", "active");

-- CreateIndex
CREATE INDEX "custom_field_definitions_org_id_custom_object_def_id_active_idx" ON "custom_field_definitions"("org_id", "custom_object_def_id", "active");

-- CreateIndex
CREATE INDEX "custom_field_definitions_deleted_at_idx" ON "custom_field_definitions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_org_id_entity_type_field_key_key" ON "custom_field_definitions"("org_id", "entity_type", "field_key");

-- CreateIndex
CREATE INDEX "custom_field_values_org_id_entity_type_entity_id_idx" ON "custom_field_values"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "custom_field_values_org_id_definition_id_idx" ON "custom_field_values"("org_id", "definition_id");

-- CreateIndex
CREATE INDEX "custom_field_values_deleted_at_idx" ON "custom_field_values"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_org_id_entity_type_entity_id_definition_key" ON "custom_field_values"("org_id", "entity_type", "entity_id", "definition_id");

-- CreateIndex
CREATE INDEX "quotes_org_id_state_updated_at_idx" ON "quotes"("org_id", "state", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "quotes_org_id_opportunity_id_idx" ON "quotes"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "quotes_org_id_account_id_idx" ON "quotes"("org_id", "account_id");

-- CreateIndex
CREATE INDEX "quotes_org_id_owner_id_idx" ON "quotes"("org_id", "owner_id");

-- CreateIndex
CREATE INDEX "quotes_org_id_idx" ON "quotes"("org_id");

-- CreateIndex
CREATE INDEX "quotes_deleted_at_idx" ON "quotes"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_org_id_number_key" ON "quotes"("org_id", "number");

-- CreateIndex
CREATE INDEX "quote_lines_org_id_quote_id_sort_order_idx" ON "quote_lines"("org_id", "quote_id", "sort_order");

-- CreateIndex
CREATE INDEX "quote_lines_org_id_product_id_idx" ON "quote_lines"("org_id", "product_id");

-- CreateIndex
CREATE INDEX "quote_lines_org_id_idx" ON "quote_lines"("org_id");

-- CreateIndex
CREATE INDEX "quote_lines_deleted_at_idx" ON "quote_lines"("deleted_at");

-- CreateIndex
CREATE INDEX "quote_versions_org_id_quote_id_created_at_idx" ON "quote_versions"("org_id", "quote_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quote_versions_org_id_idx" ON "quote_versions"("org_id");

-- CreateIndex
CREATE INDEX "quote_versions_deleted_at_idx" ON "quote_versions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_org_id_quote_id_version_key" ON "quote_versions"("org_id", "quote_id", "version");

-- CreateIndex
CREATE INDEX "pipelines_org_id_archived_idx" ON "pipelines"("org_id", "archived");

-- CreateIndex
CREATE INDEX "pipelines_org_id_idx" ON "pipelines"("org_id");

-- CreateIndex
CREATE INDEX "pipelines_deleted_at_idx" ON "pipelines"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_org_id_name_key" ON "pipelines"("org_id", "name");

-- CreateIndex
CREATE INDEX "pipeline_stages_org_id_pipeline_id_order_index_idx" ON "pipeline_stages"("org_id", "pipeline_id", "order_index");

-- CreateIndex
CREATE INDEX "pipeline_stages_org_id_forecast_category_idx" ON "pipeline_stages"("org_id", "forecast_category");

-- CreateIndex
CREATE INDEX "pipeline_stages_org_id_idx" ON "pipeline_stages"("org_id");

-- CreateIndex
CREATE INDEX "pipeline_stages_deleted_at_idx" ON "pipeline_stages"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_org_id_pipeline_id_key_key" ON "pipeline_stages"("org_id", "pipeline_id", "key");

-- CreateIndex
CREATE INDEX "integration_tokens_org_id_provider_status_idx" ON "integration_tokens"("org_id", "provider", "status");

-- CreateIndex
CREATE INDEX "integration_tokens_org_id_idx" ON "integration_tokens"("org_id");

-- CreateIndex
CREATE INDEX "integration_tokens_deleted_at_idx" ON "integration_tokens"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_tokens_org_user_provider_key" ON "integration_tokens"("org_id", "user_id", "provider");

-- CreateIndex
CREATE INDEX "calendar_events_org_id_owner_id_start_at_idx" ON "calendar_events"("org_id", "owner_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_org_id_start_at_idx" ON "calendar_events"("org_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_org_id_sync_state_idx" ON "calendar_events"("org_id", "sync_state");

-- CreateIndex
CREATE INDEX "calendar_events_org_id_idx" ON "calendar_events"("org_id");

-- CreateIndex
CREATE INDEX "calendar_events_deleted_at_idx" ON "calendar_events"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_provider_external_key" ON "calendar_events"("provider", "external_id");

-- CreateIndex
CREATE INDEX "booking_pages_org_id_user_id_is_active_idx" ON "booking_pages"("org_id", "user_id", "is_active");

-- CreateIndex
CREATE INDEX "booking_pages_org_id_idx" ON "booking_pages"("org_id");

-- CreateIndex
CREATE INDEX "booking_pages_deleted_at_idx" ON "booking_pages"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_pages_org_slug_key" ON "booking_pages"("org_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_cancel_token_key" ON "bookings"("cancel_token");

-- CreateIndex
CREATE INDEX "bookings_org_id_booking_page_id_start_at_idx" ON "bookings"("org_id", "booking_page_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_org_id_attendee_email_idx" ON "bookings"("org_id", "attendee_email");

-- CreateIndex
CREATE INDEX "bookings_org_id_idx" ON "bookings"("org_id");

-- CreateIndex
CREATE INDEX "bookings_deleted_at_idx" ON "bookings"("deleted_at");

-- CreateIndex
CREATE INDEX "ai_assistant_sessions_org_id_user_id_created_at_idx" ON "ai_assistant_sessions"("org_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_assistant_sessions_org_id_idx" ON "ai_assistant_sessions"("org_id");

-- CreateIndex
CREATE INDEX "ai_assistant_feedback_session_id_idx" ON "ai_assistant_feedback"("session_id");

-- CreateIndex
CREATE INDEX "ai_prompt_templates_org_id_kind_idx" ON "ai_prompt_templates"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_org_kind_name_key" ON "ai_prompt_templates"("org_id", "kind", "name");

-- CreateIndex
CREATE INDEX "email_messages_org_id_thread_id_idx" ON "email_messages"("org_id", "thread_id");

-- CreateIndex
CREATE INDEX "email_messages_org_id_entity_type_entity_id_idx" ON "email_messages"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "email_messages_org_id_user_id_idx" ON "email_messages"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_org_external_key" ON "email_messages"("org_id", "external_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tracking_pixels_token_key" ON "email_tracking_pixels"("token");

-- CreateIndex
CREATE INDEX "email_tracking_pixels_email_message_id_idx" ON "email_tracking_pixels"("email_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_workspaces_org_id_key" ON "slack_workspaces"("org_id");

-- CreateIndex
CREATE INDEX "slack_workspaces_org_id_idx" ON "slack_workspaces"("org_id");

-- CreateIndex
CREATE INDEX "slack_channels_org_id_idx" ON "slack_channels"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_channels_org_channel_key" ON "slack_channels"("org_id", "channel_id");

-- CreateIndex
CREATE INDEX "slack_user_mappings_org_id_slack_user_id_idx" ON "slack_user_mappings"("org_id", "slack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_user_mappings_org_user_key" ON "slack_user_mappings"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "zapier_apps_org_id_idx" ON "zapier_apps"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "zapier_apps_org_key" ON "zapier_apps"("org_id");

-- CreateIndex
CREATE INDEX "zapier_triggers_org_id_event_type_idx" ON "zapier_triggers"("org_id", "event_type");

-- CreateIndex
CREATE INDEX "zapier_actions_org_id_idx" ON "zapier_actions"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "zapier_actions_org_action_key" ON "zapier_actions"("org_id", "action_type");

-- CreateIndex
CREATE INDEX "zapier_subscriptions_org_id_event_type_idx" ON "zapier_subscriptions"("org_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "graph_subscriptions_subscription_id_key" ON "graph_subscriptions"("subscription_id");

-- CreateIndex
CREATE INDEX "graph_subscriptions_org_id_idx" ON "graph_subscriptions"("org_id");

-- CreateIndex
CREATE INDEX "graph_subscriptions_integration_token_id_idx" ON "graph_subscriptions"("integration_token_id");

-- CreateIndex
CREATE INDEX "graph_subscriptions_expires_at_idx" ON "graph_subscriptions"("expires_at");

-- CreateIndex
CREATE INDEX "custom_object_defs_org_id_idx" ON "custom_object_defs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_object_defs_org_id_key_key" ON "custom_object_defs"("org_id", "key");

-- CreateIndex
CREATE INDEX "custom_object_records_org_id_custom_object_def_id_deleted_a_idx" ON "custom_object_records"("org_id", "custom_object_def_id", "deleted_at");

-- CreateIndex
CREATE INDEX "custom_object_records_deleted_at_idx" ON "custom_object_records"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "custom_object_records_org_id_custom_object_def_id_record_ke_key" ON "custom_object_records"("org_id", "custom_object_def_id", "record_key");

-- CreateIndex
CREATE INDEX "custom_object_relations_org_id_custom_object_def_id_idx" ON "custom_object_relations"("org_id", "custom_object_def_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_object_relations_org_id_custom_object_def_id_relatio_key" ON "custom_object_relations"("org_id", "custom_object_def_id", "relation_key");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_twilio_sid_key" ON "sms_messages"("twilio_sid");

-- CreateIndex
CREATE INDEX "sms_messages_org_id_to_number_idx" ON "sms_messages"("org_id", "to_number");

-- CreateIndex
CREATE INDEX "sms_messages_org_id_entity_type_entity_id_idx" ON "sms_messages"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "sms_messages_org_id_status_idx" ON "sms_messages"("org_id", "status");

-- CreateIndex
CREATE INDEX "sms_consents_org_id_opted_out_idx" ON "sms_consents"("org_id", "opted_out");

-- CreateIndex
CREATE UNIQUE INDEX "sms_consents_org_phone_key" ON "sms_consents"("org_id", "phone_number");

-- CreateIndex
CREATE INDEX "saved_views_org_user_entity_idx" ON "saved_views"("org_id", "user_id", "entity");

-- CreateIndex
CREATE INDEX "saved_views_org_entity_shared_idx" ON "saved_views"("org_id", "entity", "shared");

-- CreateIndex
CREATE INDEX "saved_views_deleted_at_idx" ON "saved_views"("deleted_at");

-- CreateIndex
CREATE INDEX "native_push_tokens_org_id_active_idx" ON "native_push_tokens"("org_id", "active");

-- CreateIndex
CREATE INDEX "native_push_tokens_user_id_active_idx" ON "native_push_tokens"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "native_push_tokens_org_user_device_key" ON "native_push_tokens"("org_id", "user_id", "device_id");

-- CreateIndex
CREATE INDEX "call_sessions_org_entity_scheduled_idx" ON "call_sessions"("org_id", "entity_type", "entity_id", "scheduled_at" DESC);

-- CreateIndex
CREATE INDEX "call_sessions_org_id_status_idx" ON "call_sessions"("org_id", "status");

-- CreateIndex
CREATE INDEX "call_sessions_org_id_provider_idx" ON "call_sessions"("org_id", "provider");

-- CreateIndex
CREATE INDEX "call_summaries_call_session_id_idx" ON "call_summaries"("call_session_id");

-- CreateIndex
CREATE INDEX "call_summaries_org_id_key_idx" ON "call_summaries"("org_id", "key");

-- CreateIndex
CREATE INDEX "subscriptions_org_id_account_id_idx" ON "subscriptions"("org_id", "account_id");

-- CreateIndex
CREATE INDEX "subscriptions_org_id_status_idx" ON "subscriptions"("org_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_org_id_renewal_date_idx" ON "subscriptions"("org_id", "renewal_date");

-- CreateIndex
CREATE INDEX "subscriptions_deleted_at_idx" ON "subscriptions"("deleted_at");

-- CreateIndex
CREATE INDEX "renewal_opportunities_org_id_status_idx" ON "renewal_opportunities"("org_id", "status");

-- CreateIndex
CREATE INDEX "renewal_opportunities_org_id_subscription_id_idx" ON "renewal_opportunities"("org_id", "subscription_id");

-- CreateIndex
CREATE INDEX "renewal_opportunities_deleted_at_idx" ON "renewal_opportunities"("deleted_at");

-- CreateIndex
CREATE INDEX "health_scores_org_id_account_id_captured_at_idx" ON "health_scores"("org_id", "account_id", "captured_at" DESC);

-- CreateIndex
CREATE INDEX "health_scores_org_id_captured_at_idx" ON "health_scores"("org_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "nps_surveys_token_hash_key" ON "nps_surveys"("token_hash");

-- CreateIndex
CREATE INDEX "nps_surveys_org_id_account_id_sent_at_idx" ON "nps_surveys"("org_id", "account_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "nps_surveys_org_id_category_idx" ON "nps_surveys"("org_id", "category");

-- CreateIndex
CREATE INDEX "nps_surveys_deleted_at_idx" ON "nps_surveys"("deleted_at");

-- CreateIndex
CREATE INDEX "churn_signals_org_id_account_id_detected_at_idx" ON "churn_signals"("org_id", "account_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "churn_signals_org_id_severity_resolved_at_idx" ON "churn_signals"("org_id", "severity", "resolved_at");

-- CreateIndex
CREATE INDEX "churn_signals_deleted_at_idx" ON "churn_signals"("deleted_at");

-- CreateIndex
CREATE INDEX "expansion_opportunities_org_id_account_id_idx" ON "expansion_opportunities"("org_id", "account_id");

-- CreateIndex
CREATE INDEX "expansion_opportunities_org_id_status_idx" ON "expansion_opportunities"("org_id", "status");

-- CreateIndex
CREATE INDEX "expansion_opportunities_deleted_at_idx" ON "expansion_opportunities"("deleted_at");

-- CreateIndex
CREATE INDEX "yjs_documents_org_id_idx" ON "yjs_documents"("org_id");

-- CreateIndex
CREATE INDEX "yjs_documents_org_id_entity_type_entity_id_idx" ON "yjs_documents"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "yjs_documents_org_id_entity_type_entity_id_field_key_key" ON "yjs_documents"("org_id", "entity_type", "entity_id", "field_key");

-- CreateIndex
CREATE INDEX "yjs_updates_ydoc_id_created_at_idx" ON "yjs_updates"("ydoc_id", "created_at");

-- CreateIndex
CREATE INDEX "yjs_updates_org_id_created_at_idx" ON "yjs_updates"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activities_idempotency_key_key" ON "activities"("idempotency_key");

-- CreateIndex
CREATE INDEX "activities_org_entity_occurred_idx" ON "activities"("org_id", "entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activities_org_actor_occurred_idx" ON "activities"("org_id", "actor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activity_attendees_org_id_idx" ON "activity_attendees"("org_id");

-- CreateIndex
CREATE INDEX "activity_attendees_deleted_at_idx" ON "activity_attendees"("deleted_at");

-- CreateIndex
CREATE INDEX "ai_insights_deleted_at_idx" ON "ai_insights"("deleted_at");

-- CreateIndex
CREATE INDEX "api_keys_deleted_at_idx" ON "api_keys"("deleted_at");

-- CreateIndex
CREATE INDEX "bid_opportunities_deleted_at_idx" ON "bid_opportunities"("deleted_at");

-- CreateIndex
CREATE INDEX "companies_org_id_idx" ON "companies"("org_id");

-- CreateIndex
CREATE INDEX "companies_deleted_at_idx" ON "companies"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "companies_org_domain_key" ON "companies"("org_id", "domain");

-- CreateIndex
CREATE INDEX "company_enrichments_deleted_at_idx" ON "company_enrichments"("deleted_at");

-- CreateIndex
CREATE INDEX "compliance_checks_deleted_at_idx" ON "compliance_checks"("deleted_at");

-- CreateIndex
CREATE INDEX "contacts_org_id_company_id_idx" ON "contacts"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "contacts_deleted_at_idx" ON "contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "dashboard_widgets_deleted_at_idx" ON "dashboard_widgets"("deleted_at");

-- CreateIndex
CREATE INDEX "document_versions_org_id_idx" ON "document_versions"("org_id");

-- CreateIndex
CREATE INDEX "documents_org_opp_idx" ON "documents"("org_id", "opp_id");

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- CreateIndex
CREATE INDEX "dust_runs_deleted_at_idx" ON "dust_runs"("deleted_at");

-- CreateIndex
CREATE INDEX "file_attachments_org_id_company_id_idx" ON "file_attachments"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "file_attachments_org_id_idx" ON "file_attachments"("org_id");

-- CreateIndex
CREATE INDEX "file_attachments_deleted_at_idx" ON "file_attachments"("deleted_at");

-- CreateIndex
CREATE INDEX "invoice_lines_deleted_at_idx" ON "invoice_lines"("deleted_at");

-- CreateIndex
CREATE INDEX "invoices_org_id_company_id_idx" ON "invoices"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "invoices_deleted_at_idx" ON "invoices"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "memos_policies_org_id_key_key" ON "memos_policies"("org_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "memos_world_models_org_id_domain_key_key" ON "memos_world_models"("org_id", "domain", "key");

-- CreateIndex
CREATE INDEX "notes_org_id_company_id_idx" ON "notes"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "notes_org_id_idx" ON "notes"("org_id");

-- CreateIndex
CREATE INDEX "notes_deleted_at_idx" ON "notes"("deleted_at");

-- CreateIndex
CREATE INDEX "opps_org_country_idx" ON "opportunities"("org_id", "country");

-- CreateIndex
CREATE INDEX "opps_org_pipeline_stage_idx" ON "opportunities"("org_id", "pipeline_stage_id");

-- CreateIndex
CREATE INDEX "opps_org_owner_idx" ON "opportunities"("org_id", "owner_id");

-- CreateIndex
CREATE INDEX "opportunities_org_id_idx" ON "opportunities"("org_id");

-- CreateIndex
CREATE INDEX "opportunities_deleted_at_idx" ON "opportunities"("deleted_at");

-- CreateIndex
CREATE INDEX "payments_deleted_at_idx" ON "payments"("deleted_at");

-- CreateIndex
CREATE INDEX "product_categories_deleted_at_idx" ON "product_categories"("deleted_at");

-- CreateIndex
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");

-- CreateIndex
CREATE INDEX "provider_health_deleted_at_idx" ON "provider_health"("deleted_at");

-- CreateIndex
CREATE INDEX "queue_health_deleted_at_idx" ON "queue_health"("deleted_at");

-- CreateIndex
CREATE INDEX "release_scores_deleted_at_idx" ON "release_scores"("deleted_at");

-- CreateIndex
CREATE INDEX "risk_register_items_deleted_at_idx" ON "risk_register_items"("deleted_at");

-- CreateIndex
CREATE INDEX "sales_order_lines_deleted_at_idx" ON "sales_order_lines"("deleted_at");

-- CreateIndex
CREATE INDEX "sales_orders_org_id_company_id_idx" ON "sales_orders"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "sales_orders_deleted_at_idx" ON "sales_orders"("deleted_at");

-- CreateIndex
CREATE INDEX "sync_events_deleted_at_idx" ON "sync_events"("deleted_at");

-- CreateIndex
CREATE INDEX "tasks_org_status_due_idx" ON "tasks"("org_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "tasks_org_opp_idx" ON "tasks"("org_id", "opp_id");

-- CreateIndex
CREATE INDEX "tasks_deleted_at_idx" ON "tasks"("deleted_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_deleted_at_idx" ON "webhook_subscriptions"("deleted_at");

-- CreateIndex
CREATE INDEX "workflow_actions_workflow_sort_idx" ON "workflow_actions"("workflow_id", "sort_order");

-- CreateIndex
CREATE INDEX "workflow_actions_deleted_at_idx" ON "workflow_actions"("deleted_at");

-- CreateIndex
CREATE INDEX "workflows_org_active_idx" ON "workflows"("org_id", "active");

-- CreateIndex
CREATE INDEX "workflows_deleted_at_idx" ON "workflows"("deleted_at");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pipeline_stage_id_fkey" FOREIGN KEY ("pipeline_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_exports" ADD CONSTRAINT "tenant_exports_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_sections" ADD CONSTRAINT "proposal_sections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_sections" ADD CONSTRAINT "proposal_sections_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_solutions" ADD CONSTRAINT "account_solutions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_solutions" ADD CONSTRAINT "account_solutions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_products" ADD CONSTRAINT "account_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_products" ADD CONSTRAINT "account_products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attendees" ADD CONSTRAINT "activity_attendees_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attendees" ADD CONSTRAINT "activity_attendees_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attendees" ADD CONSTRAINT "activity_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_jobs" ADD CONSTRAINT "migration_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "migration_mappings" ADD CONSTRAINT "migration_mappings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictive_scores" ADD CONSTRAINT "predictive_scores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictive_models" ADD CONSTRAINT "predictive_models_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_edit_locks" ADD CONSTRAINT "entity_edit_locks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booking_page_id_fkey" FOREIGN KEY ("booking_page_id") REFERENCES "booking_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_sessions" ADD CONSTRAINT "ai_assistant_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_feedback" ADD CONSTRAINT "ai_assistant_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_assistant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_templates" ADD CONSTRAINT "ai_prompt_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracking_pixels" ADD CONSTRAINT "email_tracking_pixels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracking_pixels" ADD CONSTRAINT "email_tracking_pixels_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_workspaces" ADD CONSTRAINT "slack_workspaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_slack_workspace_id_fkey" FOREIGN KEY ("slack_workspace_id") REFERENCES "slack_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_mappings" ADD CONSTRAINT "slack_user_mappings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_user_mappings" ADD CONSTRAINT "slack_user_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_apps" ADD CONSTRAINT "zapier_apps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_triggers" ADD CONSTRAINT "zapier_triggers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_triggers" ADD CONSTRAINT "zapier_triggers_zapier_app_id_fkey" FOREIGN KEY ("zapier_app_id") REFERENCES "zapier_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_actions" ADD CONSTRAINT "zapier_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_actions" ADD CONSTRAINT "zapier_actions_zapier_app_id_fkey" FOREIGN KEY ("zapier_app_id") REFERENCES "zapier_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_subscriptions" ADD CONSTRAINT "zapier_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zapier_subscriptions" ADD CONSTRAINT "zapier_subscriptions_zapier_app_id_fkey" FOREIGN KEY ("zapier_app_id") REFERENCES "zapier_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_subscriptions" ADD CONSTRAINT "graph_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_subscriptions" ADD CONSTRAINT "graph_subscriptions_integration_token_id_fkey" FOREIGN KEY ("integration_token_id") REFERENCES "integration_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_object_defs" ADD CONSTRAINT "custom_object_defs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_object_records" ADD CONSTRAINT "custom_object_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_object_records" ADD CONSTRAINT "custom_object_records_custom_object_def_id_fkey" FOREIGN KEY ("custom_object_def_id") REFERENCES "custom_object_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_object_relations" ADD CONSTRAINT "custom_object_relations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_object_relations" ADD CONSTRAINT "custom_object_relations_custom_object_def_id_fkey" FOREIGN KEY ("custom_object_def_id") REFERENCES "custom_object_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_integration_token_id_fkey" FOREIGN KEY ("integration_token_id") REFERENCES "integration_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_call_session_id_fkey" FOREIGN KEY ("call_session_id") REFERENCES "call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_opportunities" ADD CONSTRAINT "renewal_opportunities_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "churn_signals" ADD CONSTRAINT "churn_signals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "churn_signals" ADD CONSTRAINT "churn_signals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expansion_opportunities" ADD CONSTRAINT "expansion_opportunities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expansion_opportunities" ADD CONSTRAINT "expansion_opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yjs_documents" ADD CONSTRAINT "yjs_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yjs_updates" ADD CONSTRAINT "yjs_updates_ydoc_id_fkey" FOREIGN KEY ("ydoc_id") REFERENCES "yjs_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yjs_updates" ADD CONSTRAINT "yjs_updates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "activities_org_owner_idx" RENAME TO "activities_org_id_owner_id_idx";

-- RenameIndex
ALTER INDEX "activities_org_start_idx" RENAME TO "activities_org_id_start_time_idx";

-- RenameIndex
ALTER INDEX "activities_org_type_idx" RENAME TO "activities_org_id_type_idx";

-- RenameIndex
ALTER INDEX "activity_attendees_activity_idx" RENAME TO "activity_attendees_activity_id_idx";

-- RenameIndex
ALTER INDEX "activity_attendees_contact_idx" RENAME TO "activity_attendees_contact_id_idx";

-- RenameIndex
ALTER INDEX "activity_attendees_user_idx" RENAME TO "activity_attendees_user_id_idx";

-- RenameIndex
ALTER INDEX "approval_gates_org_gate_key_idx" RENAME TO "approval_gates_org_id_gate_key_idx";

-- RenameIndex
ALTER INDEX "bid_documents_org_account_id_idx" RENAME TO "bid_documents_org_id_account_id_idx";

-- RenameIndex
ALTER INDEX "bid_documents_org_company_id_idx" RENAME TO "bid_documents_org_id_company_id_idx";

-- RenameIndex
ALTER INDEX "bid_scores_org_opportunity_id_idx" RENAME TO "bid_scores_org_id_opportunity_id_idx";

-- RenameIndex
ALTER INDEX "bid_scores_org_recommendation_idx" RENAME TO "bid_scores_org_id_recommendation_idx";

-- RenameIndex
ALTER INDEX "bid_scores_org_scored_by_idx" RENAME TO "bid_scores_org_id_scored_by_idx";

-- RenameIndex
ALTER INDEX "companies_org_domain_idx" RENAME TO "companies_org_id_domain_idx";

-- RenameIndex
ALTER INDEX "compliance_matrix_rows_org_owner_id_idx" RENAME TO "compliance_matrix_rows_org_id_owner_id_idx";

-- RenameIndex
ALTER INDEX "memos_policies_org_category_active_idx" RENAME TO "memos_policies_org_id_category_active_idx";

-- RenameIndex
ALTER INDEX "memos_policies_org_key_idx" RENAME TO "memos_policies_org_id_key_idx";

-- RenameIndex
ALTER INDEX "memos_policies_org_scope_type_scope_id_idx" RENAME TO "memos_policies_org_id_scope_type_scope_id_idx";

-- RenameIndex
ALTER INDEX "memos_traces_org_module_entity_type_entity_id_idx" RENAME TO "memos_traces_org_id_module_entity_type_entity_id_idx";

-- RenameIndex
ALTER INDEX "memos_traces_org_tier_created_at_idx" RENAME TO "memos_traces_org_id_tier_created_at_idx";

-- RenameIndex
ALTER INDEX "memos_traces_org_user_id_created_at_idx" RENAME TO "memos_traces_org_id_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "memos_world_models_org_domain_key_idx" RENAME TO "memos_world_models_org_id_domain_key_idx";

-- RenameIndex
ALTER INDEX "memos_world_models_org_expires_at_idx" RENAME TO "memos_world_models_org_id_expires_at_idx";

-- RenameIndex
ALTER INDEX "references_org_company_idx" RENAME TO "references_org_id_company_id_idx";

-- RenameIndex
ALTER INDEX "references_org_industry_idx" RENAME TO "references_org_id_industry_idx";

-- RenameIndex
ALTER INDEX "requirements_org_bid_document_id_idx" RENAME TO "requirements_org_id_bid_document_id_idx";

-- RenameIndex
ALTER INDEX "requirements_org_owner_id_idx" RENAME TO "requirements_org_id_owner_id_idx";

-- RenameIndex
ALTER INDEX "review_issues_org_owner_id_idx" RENAME TO "review_issues_org_id_owner_id_idx";

-- RenameIndex
ALTER INDEX "source_chunks_org_bid_document_id_idx" RENAME TO "source_chunks_org_id_bid_document_id_idx";

-- RenameIndex
ALTER INDEX "source_chunks_org_hash_idx" RENAME TO "source_chunks_org_id_hash_idx";

-- RenameIndex
ALTER INDEX "tenant_exports_org_created_idx" RENAME TO "tenant_exports_org_id_created_at_idx";

-- RenameIndex
ALTER INDEX "tenant_exports_org_status_idx" RENAME TO "tenant_exports_org_id_status_idx";

