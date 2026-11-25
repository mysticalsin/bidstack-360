# Dashboard pulse names sample signals

## Evidence

The home dashboard pulse used `newAlertCount` and counted `RISK` only inside the five alerts the feed returns. Demo rows are `sample` and titled `Sample:`. The pulse still said "N new signals · M risks" and painted the orb as a live alert. A loading pulse was `aria-hidden`. A failed read with no payload left the slot empty.

## Correction

The caption keeps the real new-signal total. When every loaded alert is a sample, it says so, calls those risks sample risks, and stays on the watch tone. When the new-signal total is longer than the loaded page, the risk count is "in the latest N". Loading is a status. A failed read with no payload is an alert with Retry.
