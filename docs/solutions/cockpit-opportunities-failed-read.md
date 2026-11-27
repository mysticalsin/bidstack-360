# A failed deal read is not an empty account book

The cockpit opportunities card used a missing payload as "No opportunities for this account yet". That line is only for a settled read with zero deals. A first read that fails says the deal book did not load. A later refresh that fails keeps the last loaded deals and says the refresh failed.
