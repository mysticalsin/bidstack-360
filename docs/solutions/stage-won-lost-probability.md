# A won stage stays at 100 and a lost stage stays at 0

Demo Closed Won is stored at 100 and Closed Lost at 0. The stage editor still
saved another percent, including 0 on a won stage and 40 on a lost stage. The
settings note said those semantics were protected.

`lockedStageProbability` shows 100 or 0 and ignores further typing. Save writes
that percent, including when the stored value had already drifted. The stage
PATCH refuses any other percent. An open stage such as S3 Technical Iteration
stays editable.
