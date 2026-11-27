# Webhook event figure waits for the read

The integrations hero counts the webhook list. invoice.sent and invoice.paid still ride that list after invoicing was removed. A paused read has `isLoading` false and no page. The figure said zero events and that no errors were loaded. An in-flight read did the same. A failed status with `isError` still false kept a stale count, including one invoice.paid row.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the list has not arrived. It does not say zero, it does not say no errors were loaded, and it does not say paid. Failed says Failed to load events and does not keep a stale count. A settled null payload stays on zero. A settled empty list stays on zero. A loaded invoice.paid row stays a count of one. It does not call the book paid.
