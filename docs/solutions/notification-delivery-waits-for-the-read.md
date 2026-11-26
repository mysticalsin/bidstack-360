# Delivery settings wait for the read

Settings delivery opens before the channel read returns. A paused read has `isLoading` false and no payload. The section rendered nothing, which is how a missing block looks. An in-flight read did the same. A failed status with `isError` still false kept a stale channel row.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the channels have not arrived. It does not paint a checkbox, and it does not say the load failed. Failed says the settings could not load. It does not keep a stale channel row. A settled null payload stays blank. A settled row stays, including a channel that is off and a blank webhook host.
