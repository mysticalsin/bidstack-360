# Document extractions wait for the file list

The extractions tab opens after account intelligence has loaded and before `GET /api/files` returns. A paused or in-flight read has `data === undefined` and `isLoading` false. The tab still said "No documents". A failed status with `isError` still false kept a stale file name. A settled null payload is an empty list.

`documentExtractionFilesPhase` reports `unread`, `failed`, or `ready`. Error wins, then undefined data is unread, else the read is ready. Unread says the file list has not arrived. Failed says the file list did not load and drops a stale name. A settled empty list, including a null payload, still says there are no documents. A file that arrived still shows.

The solutions and products tabs, and their source badges, are unchanged.
