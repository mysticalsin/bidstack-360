# Deal board columns were one gray stage

## Evidence

Demo pipeline stages are named Lead, Ongoing, Proposal Sent, Technical Iteration, Negotiation, Closed Won, and Closed Lost. The column badge passed that name to `stageTone`, which only knows the legacy enum keys (`s1_lead` through `closed_lost`). Every demo column rendered gray, including a win and a loss. A custom stage named Won stayed gray too, because the name is not `closed_won`.

## Correction

The board maps those demo names, and the legacy labels for the same stages, onto the existing badge tones. A stage flagged won or lost uses that flag. A name the board does not know stays gray.
