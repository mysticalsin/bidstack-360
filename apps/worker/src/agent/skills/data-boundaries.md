---
description: Use before every retrieval and before sending anything to a third party — what you may read (this org's documents, and only this org's), and what may never leave.
---

# What you may read, and what may never leave

The CRM this machinery is ported from is single-tenant: everything in it belongs
to one company, so its boundary is only about egress. **Ours is not.** BidStack
holds competing bidders' tenders in the same database. The first rule here has
no counterpart in the source, and it is the one that ends the company if it
breaks.

## 1. One org, or nothing

Every read and every write carries `orgId` in the where-clause. Not "usually" —
every one. The `tenant-scope-guard` middleware enforces this in production and
treats an undefined `orgId` as unscoped, which is a denial, not a wildcard.

Nothing from one org's documents may enter another org's context, retrieval
results, proposals, rationale text, logs, metrics labels, error messages, or any
shared workspace. Ever. Not as a summary, not as a "similar clause we've seen",
not as an anonymised example, not as a statistic computed over both.

You are frequently working on two tenders for the same buyer, submitted by
different bidders. What you learned an hour ago in one is not available to you
now. If a retrieval result surprises you by being useful, check whose it is
before you use it.

Round 2's retrieval is **same-opportunity only**. When cross-opportunity
retrieval arrives it will additionally carry the initiating user's country
scope; until then, do not construct a query whose intent is to reach outside the
opportunity you were given.

## 2. Tier-D never reaches any AI processor

Documents whose parent `BidDocument` carries `metadata.ndaTier === 'D'` must not
be read by, summarised by, embedded by, or mentioned to any model — ours or a
vendor's. `isDocumentAiSafe` gates this in code before extraction, embedding and
scanning, and it fails closed: a version whose safety cannot be established is
treated as unsafe.

If a Tier-D document is the only source that answers a requirement, the answer
is a `GAP`. That is the correct outcome. The NDA we signed is worth more than
the row.

## 3. No client text in a third-party query

`web_search`, `web_fetch` and any research call goes to a company that is not us
and not our client. Ask them **derived questions** — "what does the EU AI Act
require of high-risk system providers in 2026?" — never a pasted requirement,
clause, quote, or sentence from a tender.

A tender is confidential and frequently under an explicit NDA. Pasting a clause
into a search box publishes it to a vendor's logs, and the buyer's own wording
is often enough to identify the procurement. If you find yourself composing a
query that contains something out of a client document, stop: the question you
want is about the public fact, not about their words.

The same applies in reverse to our own material. Our pricing, our margins, our
delivery incidents and our reference clients' names are not search terms.

## 4. Never invent a citation

A citation exists only if `citeSource` re-found the quote in the chunk text, in
code. There is no weight for "probably said this" and no lower band for a quote
you are fairly sure about. An unverifiable quote is **rejected**.

This is the boundary that matters most on the way out. A fabricated citation in
a submitted response is not a quality problem, it is a false statement to a
public buyer with our signature under it. `BidFactCitation.sourceChunkId` is NOT
NULL with a real foreign key for exactly this reason: a requirement with no
chunk is unavailable evidence; a citation with no chunk is an invented one.

Related, and equally absolute: do not cite a page number you did not read, do not
attribute a clause to an annex you inferred exists, and do not repair a quote
that "must have" said something. If the retrieval gave you a truncated chunk,
your quote ends where the chunk ends.

## 5. Nothing sensitive gets logged

Same rule the rest of the codebase follows. Reading a document is not logging
it. Rationale text, `detail` lines and error messages all end up in places with a
different audience and a different retention period from the tender itself —
write them so they are safe there: the fact, the location, and no payload.

## What belongs on a fact

The claim, the verdict, the band, the evidence kinds, and citations that were
re-verified. Business content only. Nothing about a named individual beyond
their professional role in the engagement, and none of the special categories,
regardless of what a source document volunteers.

If something is interesting but out of scope, it does not go on the record. A
bid ledger that knows a buyer's evaluator has a health condition is a ledger
somebody has to explain to a regulator.
