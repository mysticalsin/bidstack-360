# The command palette shows one row per record

⌘K merged the dashboard snapshot, the opportunity search, and workspace search into one list. Each source minted its own id for the same destination (`account:<id>` and `search:company:<id>`, `opp:<id>` and `search:opportunity:<id>`). On the demo book, CI Financial appeared twice: an account row and a company row, both opening `/accounts/c0000000-0000-4000-8000-000000000001`.

The list now keeps one row per canonical id. When both addresses are records, the earlier row stays, so the dashboard copy keeps its logo. A later row replaces it only when the earlier row is a `?search=` list address and the later row is the record. A note that only workspace search returned stays. The local contact and task href builders are unchanged.
