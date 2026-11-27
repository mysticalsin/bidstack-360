# Org photo waits for the read

The org chart photo loads an API path as a blob. A paused read has `isLoading` false and no blob. The avatar showed initials, which is how a person with no photo looks. An in-flight read did the same. A failed status with `isError` still false kept a stale blob.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the photo has not arrived. It does not show initials, and it does not say the load failed. Failed says Could not load the photo and does not keep a stale blob. A settled null payload stays on initials. A settled empty blob stays on initials. No photo URL stays on initials. An http URL stays on initials and is not loaded. A loaded blob stays an image. An https URL stays an image.
