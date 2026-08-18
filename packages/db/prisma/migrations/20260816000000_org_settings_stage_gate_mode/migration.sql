-- Amaris per-org stage-gate mode override (null = fall back to STAGE_GATE_MODE env).
ALTER TABLE "org_settings" ADD COLUMN "stage_gate_mode" TEXT;
