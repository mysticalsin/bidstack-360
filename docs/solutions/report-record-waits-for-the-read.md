# Report record waits for the read

The report editor asks for the saved report as soon as edit opens. A paused read and an in-flight read both have `data === undefined` and `isLoading === false`. The page treated that as a missing report: Report not found, and that it may have been deleted. A later failure used that same missing title.

`reportRecordPhase` decides the status. An error wins. Undefined data is unread. Anything else, including a settled null, is ready. Unread says Checking this report and does not open the editor. A failed read says Could not load this report and drops a stale report. A settled null stays missing. A loaded report stays, including a blank name, a name of 0, and a row limit of zero.
