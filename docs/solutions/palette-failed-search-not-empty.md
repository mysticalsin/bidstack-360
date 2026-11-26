# A palette miss waits for a finished search

The command palette prints "No matches." when the merged row list is empty and `isFetching` is false. That was true during the 200ms debounce, before either server search had started, and again after `/api/search` or the opportunity search failed. A failed read is not an empty catalog.

`paletteServerRead` allows "No matches." only once the typed query is too short to search, or both server reads have succeeded. Until the debounced query catches up, and while either read is in flight, the palette says "Searching…". After a failed read with no rows, it says "Search could not be completed." Rows already on screen stay.
