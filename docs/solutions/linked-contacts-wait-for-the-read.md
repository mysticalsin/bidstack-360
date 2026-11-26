# Linked contacts wait for the read

The deal contacts tab opens before `GET /api/opportunities/:id/contacts` returns. A paused or in-flight read has `data === undefined` and `isLoading` false. The header still said 0 contacts, and the panel said there were no linked contacts. A failed status with `isError` still false kept a stale name.

`contactsPanelPhase` reports `unread`, `failed`, or `ready`. Error wins, then undefined data is unread, else the read is ready. Unread says the list has not arrived and does not paint a zero count, the empty sentence, or Link contact. Failed says "Could not load linked contacts." and drops a stale name. A settled empty list, including a null payload, still says there are no linked contacts and still counts 0. A contact that arrived still shows, including a blank email and a continued page that is not the whole book.

The link form stays off until that read is ready. The page caption for a loaded list is unchanged.
