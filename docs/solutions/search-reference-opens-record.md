# Workspace search opens a case study on its row

Workspace search built `/references?search=<title>` for a case study. The reference library reads `q` and `expand`. It does not read `search`, so a demo case study such as "CI Financial — Core banking platform modernization" opened the whole library. A title can also match a different case study. There is no `/references/:id` route. The case study is the expanded row.

Search now links `/references?expand=<uuid>`. A title, a path, or a blank is not an address. The command palette's server results use the same url.
