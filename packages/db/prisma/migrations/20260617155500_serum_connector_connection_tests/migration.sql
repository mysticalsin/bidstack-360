-- CreateTable
CREATE TABLE "serum_connector_connection_tests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "environment" VARCHAR(30) NOT NULL DEFAULT 'dev',
    "connector_id" VARCHAR(120) NOT NULL,
    "operation" VARCHAR(160) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'success',
    "tested_by_user_id" UUID,
    "tested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serum_connector_connection_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serum_connector_tests_runtime_idx" ON "serum_connector_connection_tests"("org_id", "environment", "connector_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "serum_connector_tests_org_connector_tested_idx" ON "serum_connector_connection_tests"("org_id", "connector_id", "tested_at");

-- AddForeignKey
ALTER TABLE "serum_connector_connection_tests" ADD CONSTRAINT "serum_connector_connection_tests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
