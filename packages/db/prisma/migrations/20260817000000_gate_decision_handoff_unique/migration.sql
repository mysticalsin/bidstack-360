-- One Presales->Bid Office handoff per opportunity, enforced by the database.
--
-- The handoff was written with a check-then-create (findFirst, then create) in
-- a fire-and-forget block outside the stage-move transaction: two concurrent
-- boundary-crossing moves both read "no handoff yet" and both wrote one, and
-- both fanned out the webhook. A PARTIAL unique index is the right shape here
-- because gate_decisions is append-only for human sign-offs — the same
-- opportunity legitimately carries many go_no_go / bid_no_bid rows — so the
-- uniqueness must apply to the synthetic system event alone.
--
-- Prisma's schema language cannot express a partial (WHERE-filtered) unique
-- index, so it lives here and the model carries a comment pointing at it.
-- Duplicates that predate this index would block creation; delete all but the
-- earliest per (org, opportunity) first so the index can be built.
DELETE FROM "gate_decisions" a
USING "gate_decisions" b
WHERE a."gate" = 'bid_office_handoff'
  AND b."gate" = 'bid_office_handoff'
  AND a."org_id" = b."org_id"
  AND a."opportunity_id" = b."opportunity_id"
  AND (a."decided_at" > b."decided_at" OR (a."decided_at" = b."decided_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX "gate_decisions_bid_office_handoff_key"
  ON "gate_decisions" ("org_id", "opportunity_id")
  WHERE "gate" = 'bid_office_handoff';
