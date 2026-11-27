# Opportunity briefs name the demo industry

## Problem

Demo OP-2041 stores `industry` as `financial_services`. The opportunity
record title-cases that key to Financial Services. `POST /opportunities/:id/brief`
printed the key. The rest of the industry picker did the same, including
Real Estate and Professional Services.

## Solution

The brief asks `opportunityBriefIndustry` for the label. A catalog key
prints the same words the record shows. A stored value that is not in the
catalog, including `zz_custom`, stays as written. A blank industry stays
"not set". The value line is unchanged.

## Prevention

A seeded bid must not show an industry key in the exec brief. Lock the
picker names, and lock that the industry line calls the helper instead of
printing `opportunity.industry`.
