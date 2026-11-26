# An unread extension search is not an empty one

The extension popup search panel (`#search-results`) used `result?.data ?? []` and printed "No results found" whenever that list was empty. A reply with no list, a paused read, and an older empty reply for a query that is no longer in the box all took that sentence. A rejected read with no message left a blank line.

`paintExtensionSearch` keeps those cases off the empty sentence. A list that has not arrived says so. A rejected read says it did not load. A reply that is not the current query stays on Searching. A list that arrived empty still says "No results found". A row that arrived stays on the list.
