# Saved classification waits for the record

The bid classification panel offers every gate when no class is saved. On the bid matrix, a selected deal passes `saved` as null until the opportunity list returns, and a deal missing from that page does the same. The panel treated that null as an unclassified bid: 5 FTE, medium commitment, and every gate.

The panel reads the opportunity only when a deal is selected and the caller did not already pass a saved assessment. Error is failed. Undefined data is unread. A payload that arrived is ready, including a null body. A caller-supplied assessment skips the read.

Unread says the record has not arrived and does not show the team-size field or the gate list. Failed says the classification could not be loaded and does not keep a stale class. A settled null payload says no saved classification is on the opportunity. A loaded class stays, including an unclassified record and a class the caller already passed.
