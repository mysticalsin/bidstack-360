# Connection tester waits for the setup contract

Settings integrations probe an endpoint from the setup contract. A paused read has `isLoading` false and no contract. The tester said it was ready to test. An in-flight read did the same. A failed status with `isError` still false kept a stale endpoint.

The phase is `unread`, `failed`, or `ready`. Error wins. A missing contract is unread. A settled contract stays ready to test.

Unread says the endpoint has not arrived. It does not say the tester is ready, and it does not say the load failed. Failed says the contract could not be loaded and does not keep a stale endpoint.
