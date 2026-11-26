# Governance record waits for the read

## Evidence

`BidGovernancePanel` treated a missing gate-decision payload as an empty record. A paused first read has `isLoading` false and no items, so the bid/no-bid panel said no gate decisions were recorded. An in-flight read keeps the loading mark. A failed read already says the record could not load.

## Correction

`gateRecordPhase` reports idle, loading, unread, empty, failed, or ready. Unread says the record has not arrived. It does not say no gate decisions were recorded. A settled list with no rows still says that. A loaded record still shows.

## Verification

`BidGovernancePanel.test.tsx`. The paused case failed before the phase check.
