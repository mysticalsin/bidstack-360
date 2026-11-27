# An unread palette catalog is not an empty match list

The command palette matches companies, contacts, and tasks from their own reads, then says "No matches." when the row list is empty and the server searches are idle. That sentence showed up after `/api/search` and the opportunity search both succeeded with no rows, while the company snapshot, the contact book, or the task list still had no payload. A failed read with no payload did the same.

`paletteCatalogRead` allows "No matches." only once each of those three reads has a payload. Until then the empty palette says the catalogs have not arrived. A failed read says it could not load them. A company row that has already arrived stays on screen.
