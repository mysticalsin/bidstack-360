-- CreateTable
CREATE TABLE "user_groups" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope_all" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_group_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_groups_org_id_idx" ON "user_groups"("org_id");

-- CreateIndex
CREATE INDEX "user_groups_deleted_at_idx" ON "user_groups"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_org_id_name_key" ON "user_groups"("org_id", "name");

-- CreateIndex
CREATE INDEX "user_group_members_org_user_idx" ON "user_group_members"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "user_group_members_org_id_idx" ON "user_group_members"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_members_group_id_user_id_key" ON "user_group_members"("group_id", "user_id");

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

