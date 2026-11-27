# Relationships wait for the read

The relationships diagram reads a React Query company list, then the people on the selected company. A paused read has `isLoading` false and no payload. The diagram showed only a skeleton. An in-flight read did the same. A failed people read kept the last person.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the companies, or the people, have not arrived. It does not draw the bands, and it does not say the load failed. Failed says the read could not be loaded and does not keep a stale company or person. A settled list with no companies stays empty. A settled company with no linked people stays empty. A loaded company and a loaded person stay.
