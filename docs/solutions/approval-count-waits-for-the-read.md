# Approval count waits for the read

SERUM mission control prints an Open approvals card from `approval_gates`. When that table is missing, the count SQL is replaced with `0`. When the catalog probe or the count query throws, the fallback row is also zeros. The card then said Ready and 0, and the human-approval panel said there were no pending gates.

The phase is `unread`, `failed`, or `ready`. A failed probe or a failed count is `failed`. A missing table is `unread`. A count that arrived is `ready`, including a real zero.

Unread says the gates have not been read and does not print 0 or Ready. Failed says the gates could not be loaded and does not print 0 or Ready. A settled zero stays Ready. A settled total above zero stays Active. The side panel repeats that card. A caller that only passes the number still treats zero as none.

Settings still reads `summary.openApprovals` as a number. That section is owned elsewhere and is not changed here.
