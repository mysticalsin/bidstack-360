-- Add 'dust' to the integration_type enum so per-org Dust credentials can be
-- stored on IntegrationConfig (type='dust', name='dust') instead of abusing
-- another provider's type. Idempotent (IF NOT EXISTS). Wave 10.
--
-- PG12+ permits ALTER TYPE ... ADD VALUE inside a transaction as long as the
-- new value is not USED in the same transaction (this migration only adds it).
ALTER TYPE "integration_type" ADD VALUE IF NOT EXISTS 'dust';
