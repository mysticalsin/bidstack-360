# Company reads wait for the payload

A paused read has `isLoading` false and `data` undefined. The workspace treated that as empty: the dashboard opened Getting started, Accounts said "No accounts yet", Companies said "No accounts on the radar", the company header drew "Not refreshed yet", and key numbers said the load failed.

`readPhase` decides the status. Error wins, including when a previous payload is still in hand. Undefined data is unread. A settled value, including null and a zero count, is ready.

Unread says Checking. It does not draw the empty org, the empty list, the intel gaps, or a failed-load alert. A failed read says it could not load and does not keep the empty gaps. A settled empty list stays empty. A loaded open-role count of 0 stays 0.
