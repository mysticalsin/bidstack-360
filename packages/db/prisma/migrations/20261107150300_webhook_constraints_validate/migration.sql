-- Validates the constraints added NOT VALID in 20261107150000. VALIDATE takes
-- only a SHARE UPDATE EXCLUSIVE lock, so reads and writes continue.
ALTER TABLE "webhook_subscriptions" VALIDATE CONSTRAINT "webhook_subs_retry_policy_bounds";

ALTER TABLE "webhook_deliveries" VALIDATE CONSTRAINT "webhook_deliveries_message_id_fkey";
