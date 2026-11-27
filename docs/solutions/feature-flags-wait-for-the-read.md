# Feature flags wait for the read

A paused feature-flag read has `isLoading` false and `data === undefined`. `useFeatureFlags` used to turn that into every switch false, so the cockpit looked as if revenue and win/loss were off.

`featureFlagsPhase` lets an error win, treats undefined data as unread, and treats anything else as ready. A settled null payload and a settled all-false payload stay off. A loaded on switch stays on. `FeatureFlagsStatus` says when the read has not arrived and when it failed. The signal coverage card shows that line.
