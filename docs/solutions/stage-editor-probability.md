# Stage editor probability stays the number that was typed

Demo S3 Technical Iteration is stored at 60, and Closed Won at 100. The stage
editor parsed a cleared probability field as 0 and clamped 150 to 100, then
enabled Save. A non-numeric value enabled Save and the submit handler returned
without an error.

`stageProbabilityDraft` accepts a percent from 0 to 100 with at most two decimal
places. An empty field and any other value are not saved. The row names the
stage on the probability field and the Save button, and shows the reason Save
is unavailable.

The list caption for a continued stage page is unchanged.
