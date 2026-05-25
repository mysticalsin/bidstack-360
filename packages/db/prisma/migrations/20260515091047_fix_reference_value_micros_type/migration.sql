-- AlterTable
ALTER TABLE "references" ALTER COLUMN "value_micros" TYPE BIGINT USING ("value_micros"::BIGINT);
