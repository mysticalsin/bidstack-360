# A failed header-search history is not an empty one

The header search box reads recent queries from localStorage once, when the store is created. A thrown read, corrupt JSON, or a non-array payload used to become `[]`, and the focused box stayed blank. That is the same screen as a history that arrived with no queries.

`readRecentSearches` keeps those cases as `failed`. The box then says the recent searches could not be read. A missing key stays a quiet empty history. A stored query still lists.
