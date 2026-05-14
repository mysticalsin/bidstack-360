# Meeting Notes Import

## Problem

Bid and presales users paste rich meeting notes, but the CRM previously stored them as plain text only. Tech stack, contacts, risks, compliance, and follow-up actions stayed trapped in the note body.

## Solution

Add a paste-first importer that:

- saves the original meeting note as a pinned note,
- extracts deterministic CRM signals without using an LLM,
- writes contacts, risks, compliance checks, and tasks to existing tables,
- stores detected technical stack in `CompanyEnrichment.providerMetadata.meetingTechStack`,
- attaches `meeting_notes_import` source attribution so cockpit data is traceable.

## Why This Shape

Parsing is deterministic because vendor matching, action extraction, and source receipts are code-shaped work. Future Dust/AI can summarize or recommend, but the CRM write path must remain explainable and usable without API keys.

## Verification

Target tests cover schema validation and the `POST /api/notes/import-meeting` route with stack, contact, risk, compliance, and task extraction.
