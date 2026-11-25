# Opportunity briefs name the demo stage

## Problem

Demo OP-2041 stores `stage` as `s3_technical_iteration` and leaves
`pipelineStageId` empty. `POST /opportunities/:id/brief` printed that key.
The default pipeline catalog names the same key Technical Iteration. The
rest of the demo book did the same with Lead, Ongoing, Proposal Sent,
Negotiation, Closed Won, and Closed Lost.

## Solution

The brief route asks `opportunityBriefStage` for the label before the
markdown is built. A stored pipeline stage name still wins. A key outside
the catalog stays as written. The value line is unchanged.

## Prevention

A seeded bid with no pipeline stage must not show the enum key in the exec
brief. Lock the seven catalog names, and lock that the brief route calls
the helper instead of passing `pipelineStage.name` straight through.
