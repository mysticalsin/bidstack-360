# Data source catalog waits for the read

Settings data sources reads a React Query provider catalog. A paused read has `isLoading` false and no providers. The card said No data sources. An in-flight read showed only a skeleton. A failed status with `isError` still false used the same empty title.

The phase is `unread`, `failed`, `empty`, or `ready`. Error wins. Undefined data is unread. A settled empty list, including a null payload, stays empty. A loaded provider stays.

Unread says the catalog has not arrived. It does not say there are no sources, and it does not say the load failed. Failed says the sources could not be loaded and does not keep a stale provider.
