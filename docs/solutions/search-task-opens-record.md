# Workspace search opens a follow-up on its record

Workspace search built `/tasks?search=<title>` for a follow-up. The tasks page does not read that query, so a demo follow-up such as "Workshop with Logistec CISO" opened the whole list. A title can also match a different follow-up.

Search now links `/tasks/<uuid>`. A title, a path, or a blank is not an address. The command palette's server results use the same url. The palette's own task list is a separate link.
