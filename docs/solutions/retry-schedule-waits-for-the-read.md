# Retry schedule waits for the read

The retry schedule editor reads a React Query policy and a response-time sample for one webhook endpoint. A paused read has `isLoading` false and no policy. The editor filled the product default, which looks like a stored schedule. An in-flight read did the same. A failed read did the same, including when a stale policy was still in memory. A paused response-time read said the last 7 days had no attempts.

The phase is `unread`, `failed`, or `ready`. Error wins. Undefined data is unread. Anything else is ready.

Unread says the schedule has not arrived. It does not paint the default curve, and it does not say the load failed. Failed says the schedule could not be loaded and does not keep a stale policy. A settled read with no policy stays empty. A loaded policy stays, including a policy that matches the product default. Unread response times say the attempts have not arrived. A failed response-time read stays on the error. A settled week with no attempts stays empty. Loaded samples stay. An empty endpoint list stays on the add-endpoint prompt.
