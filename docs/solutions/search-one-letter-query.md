# A one-letter workspace search is a search

The search page prints "No results found" when `useGlobalSearch` is idle and has no data. The hook used to wait for two characters, so `/search?q=S` never called `/api/search`. In the demo book that letter is Siemens, Sanofi, Stellantis, and Spotify. A padded ` S ` was a different cache key and stayed idle, which dropped a hit the unpadded letter had already loaded.

The hook now searches any non-blank term. The query key is the trimmed term, so `S` and ` S ` are one search. A blank box still does not fetch.
