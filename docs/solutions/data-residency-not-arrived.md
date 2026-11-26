# Data residency does not paint a pin before the view arrives

Settings data residency rendered the region form whenever the query object was truthy. A placeholder, a pending shell, and a partial payload all counted. The form then said Not pinned, that exports use the default bucket, or that a regional bucket is configured. A failed status with `isError` still false kept a stale available region.

The claim is `skeleton`, `failed`, `withheld`, or `ready`. Loading stays on the skeleton. An error, including `status === 'error'` while `isError` is still false, stays on the load error and drops the stale region. A placeholder, a pending object, or a view missing `enforced` or `regionalStorage` says the data region has not arrived. It does not name a pin or a bucket. A settled view stays, including a region that is not pinned and a region whose bucket is configured.

Undefined data with no error still says the load failed. That paused read is a separate case.
