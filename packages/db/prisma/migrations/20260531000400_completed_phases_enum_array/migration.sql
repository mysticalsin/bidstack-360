-- Reconcile rfp_orchestrations.completed_phases with the Prisma schema.
--
-- The original Wave-9 migration (20260527000000_rfp_vector_indexes) created
-- completed_phases as TEXT[], but schema.prisma declares it RfpResponsePhase[]
-- (the enum array). The worker pipeline writes enum-cast values into the column
-- (INSERT ARRAY[]::"RfpResponsePhase"[] + array_append(..., x::"RfpResponsePhase")),
-- which fails with "column is of type RfpResponsePhase[] but expression is of
-- type text[]" against any database still on the original TEXT[] definition.
--
-- Convert the column to the enum array so the schema, a fresh `migrate deploy`,
-- and the worker SQL all agree. Idempotent: a no-op where completed_phases is
-- already RfpResponsePhase[] (e.g. databases brought up via `prisma db push`),
-- so it is safe to apply on every environment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'rfp_orchestrations'
      AND column_name = 'completed_phases'
      AND udt_name = '_text'  -- internal name for text[]
  ) THEN
    -- DROP DEFAULT first: a TEXT[] default ('{}') cannot be auto-cast during the
    -- TYPE change. Re-add the (now enum[]) default afterward.
    ALTER TABLE rfp_orchestrations ALTER COLUMN completed_phases DROP DEFAULT;
    ALTER TABLE rfp_orchestrations
      ALTER COLUMN completed_phases TYPE "RfpResponsePhase"[]
      USING completed_phases::"RfpResponsePhase"[];
    ALTER TABLE rfp_orchestrations ALTER COLUMN completed_phases SET DEFAULT '{}';
  END IF;
END $$;
