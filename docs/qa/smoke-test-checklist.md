# BidStack 360° — Manual Smoke Test Checklist
**Version:** Wave 5 Post-Merge
**Estimated time:** 45 minutes
**Prerequisites:** All branches merged, `pnpm install` + `pnpm db:generate` + `pnpm db:migrate` run, `pnpm dev` running (ports 3000 web / 4000 api), PostgreSQL + Redis running.
**Tester:** _______________
**Date:** _______________
**Environment:** ☐ local dev  ☐ staging

---

## How to Use This Checklist
- Tick the checkbox when the step is executed.
- Record the actual result in the **Actual** column.
- Mark **P/F** (Pass / Fail). Failures go in `docs/qa/known-issues.md`.
- If a feature is not merged yet, mark **N/A (not merged)**.

---

## 1. Auth — ~5 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 1.1 | ☐ Navigate to `/` on an incognito window | Redirected to Clerk sign-in | | |
| 1.2 | ☐ Sign up with a new email | Email verification sent | | |
| 1.3 | ☐ Verify email via link | Redirected to dashboard at `/dashboard` | | |
| 1.4 | ☐ Log out (profile menu → Sign out) | Redirected to sign-in | | |
| 1.5 | ☐ Log back in with same account | Dashboard loads within 3s | | |
| 1.6 | ☐ (If Azure SSO configured) Navigate to `/sso/microsoft/login/<orgSlug>` | Redirected to Microsoft sign-in | | |
| 1.7 | ☐ (SSO) Complete Microsoft sign-in | Redirected to dashboard; user created/matched in DB | | |

---

## 2. Lead Management — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 2.1 | ☐ Navigate to `/leads` | Lead list loads; empty state or seeded leads visible | | |
| 2.2 | ☐ Click "New Lead" → fill name, email, company | Lead created; appears in list | | |
| 2.3 | ☐ Open lead detail → assign to a user | Assignee updated; activity log entry appears | | |
| 2.4 | ☐ Log an activity (call / meeting note) | Activity appears in timeline | | |
| 2.5 | ☐ Click "Convert to Opportunity" | Opportunity created; lead status updated | | |

---

## 3. Pipeline / Opportunities — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 3.1 | ☐ Navigate to `/pipeline` | Kanban board renders with stages | | |
| 3.2 | ☐ Drag a deal card to the next stage | Stage updated; optimistic UI smooth | | |
| 3.3 | ☐ Open opportunity → click "Won" | Status = WON; confetti or success state | | |
| 3.4 | ☐ Open another opportunity → click "Lost" | Status = LOST; reason modal or field | | |
| 3.5 | ☐ Check that won/lost do NOT re-appear in active pipeline | Board filtered correctly | | |

---

## 4. Notifications — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 4.1 | ☐ Create a task and assign it to another user (or yourself) | Bell icon in top nav shows badge count | | |
| 4.2 | ☐ Click the bell → notification panel opens | Assignment notification listed | | |
| 4.3 | ☐ Click "Mark all read" | Badge count clears; notifications marked read | | |
| 4.4 | ☐ Check email inbox (if Resend configured) | Task assignment email received | | |

---

## 5. Calendar Integration — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 5.1 | ☐ Navigate to Settings → Integrations | Google Calendar connect button visible | | |
| 5.2 | ☐ Click "Connect Google Calendar" | OAuth redirect to Google | | |
| 5.3 | ☐ Authorize BidStack | Redirected back; integration shows as connected | | |
| 5.4 | ☐ Navigate to `/calendar` | Events from Google Calendar visible | | |
| 5.5 | ☐ Create an event in BidStack | Event appears in Google Calendar (allow up to 60s) | | |
| 5.6 | ☐ Create event in Google Calendar | Event synced to BidStack calendar view | | |

---

## 6. Booking Page — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 6.1 | ☐ Navigate to Settings → Booking Pages | Booking page management UI | | |
| 6.2 | ☐ Create a booking page with slug `test-slug` | Booking page saved | | |
| 6.3 | ☐ Visit `/book/test-slug` in incognito | Public booking page renders with available slots | | |
| 6.4 | ☐ Pick a slot → fill in name/email → submit | Booking confirmed; confirmation shown | | |
| 6.5 | ☐ Check DB: `Booking` row created | Row exists with correct data | | |

---

## 7. E-Signature — ~5 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 7.1 | ☐ Navigate to `/signatures` | Signature requests list; empty state | | |
| 7.2 | ☐ Navigate to `/document-templates` | Template list; empty state | | |
| 7.3 | ☐ Create a document template with a placeholder field | Template saved | | |
| 7.4 | ☐ From an opportunity, click "Send for Signature" → select template → enter recipient email | Signature request created; request shown in list | | |
| 7.5 | ☐ Open recipient email → click signing link | Navigated to `/sign/:token` | | |
| 7.6 | ☐ Sign in the signature pad → submit | Status updates to COMPLETED | | |
| 7.7 | ☐ Check `SignatureRequest` status in BidStack | Status = SIGNED; event logged | | |

---

## 8. AI Assistant — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 8.1 | ☐ Press Cmd+K (or Ctrl+K) | Command palette opens | | |
| 8.2 | ☐ Type "draft email" → select action | AI email draft modal opens | | |
| 8.3 | ☐ Fill context (recipient, purpose) → generate | Draft generated in modal | | |
| 8.4 | ☐ Click "Use draft" | Draft populated in compose area | | |
| 8.5 | ☐ Click FAB (AI icon) | AiAssistantPanel slides in | | |
| 8.6 | ☐ Select "Meeting Prep" for an opportunity | Meeting prep summary generated | | |

---

## 9. Workflows — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 9.1 | ☐ Navigate to `/workflows` | Workflow builder page loads | | |
| 9.2 | ☐ Create workflow: trigger = "Lead Created", action = "Assign round-robin" | Workflow saved | | |
| 9.3 | ☐ Enable the workflow | Status = Active | | |
| 9.4 | ☐ Create a new lead | Workflow fires; assignment logged in activity | | |
| 9.5 | ☐ Check `WorkflowRun` in DB or audit log | Run record with status = SUCCEEDED | | |

---

## 10. Analytics — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 10.1 | ☐ Navigate to `/analytics` or `/reports` | Analytics page loads; blank state or sample charts | | |
| 10.2 | ☐ Open Report Builder → select entity (Opportunities) → add metric (COUNT) | Preview updates | | |
| 10.3 | ☐ Save the report → view saved reports list | Report appears | | |
| 10.4 | ☐ Schedule the report (daily email) | Schedule created; confirmation | | |
| 10.5 | ☐ Check email inbox after next scheduled run | Report email received with data | | |

---

## 11. CRM Migration — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 11.1 | ☐ Navigate to Settings → Migration | Migration page loads | | |
| 11.2 | ☐ Upload a sample Salesforce CSV (contacts format) | File accepted; column preview shown | | |
| 11.3 | ☐ Map source columns to BidStack fields | Mapping UI responds | | |
| 11.4 | ☐ Click "Run Migration" | Migration job created; progress shown | | |
| 11.5 | ☐ After completion, check imported record count | Matches CSV row count | | |

---

## 12. Gmail Integration — ~4 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 12.1 | ☐ Navigate to Settings → Integrations → Gmail | Gmail connect button | | |
| 12.2 | ☐ Click "Connect Gmail" | OAuth redirect to Google | | |
| 12.3 | ☐ Authorize with a Gmail account | Connected; sync begins | | |
| 12.4 | ☐ Open a contact that has email history → EmailThreadView | Emails listed from Gmail | | |
| 12.5 | ☐ Send a reply from BidStack | Email sent via Gmail; appears in thread | | |
| 12.6 | ☐ Check tracking pixel: open the email from recipient side | Open event recorded (EmailTrackingPixel row) | | |

---

## 13. PWA / Offline — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 13.1 | ☐ On mobile or Chrome DevTools mobile emulation, add to home screen | PWA install prompt or home screen icon | | |
| 13.2 | ☐ Put browser in offline mode (DevTools → Network → Offline) | App loads from cache; offline indicator shown | | |
| 13.3 | ☐ Create a lead while offline | Form accepted; queued locally | | |
| 13.4 | ☐ Restore network | Offline queue syncs; lead appears in DB | | |

---

## 14. Custom Fields — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 14.1 | ☐ Navigate to Settings → Custom Fields | CustomFieldsAdminPage loads | | |
| 14.2 | ☐ Create a text field named "Industry Segment" on Contact | Field saved | | |
| 14.3 | ☐ Open a Contact detail page | "Industry Segment" field visible in UI | | |
| 14.4 | ☐ Set value for the field | Value saved | | |
| 14.5 | ☐ Search contacts by the custom field value | Matching contacts returned | | |

---

## 15. RBAC — ~3 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 15.1 | ☐ Navigate to Settings → Roles | Roles page lists 6 built-in roles | | |
| 15.2 | ☐ Assign "Read-Only" role to a test user | User role updated | | |
| 15.3 | ☐ Log in as that user | Dashboard loads | | |
| 15.4 | ☐ Attempt to create a lead | Button disabled or returns 403 | | |
| 15.5 | ☐ Attempt to edit an opportunity | Edit blocked with permission error | | |

---

## 16. Onboarding Tour — ~2 min

| # | Step | Expected | Actual | P/F |
|---|---|---|---|---|
| 16.1 | ☐ Clear tour state (localStorage → remove `tour.*` keys) and reload | Tour overlay appears on next page load | | |
| 16.2 | ☐ Walk through step 1 → step 6 | Each step highlights the correct UI element | | |
| 16.3 | ☐ Complete the tour | Tour marked complete; QuickStart panel visible | | |
| 16.4 | ☐ Reload page | Tour does NOT restart | | |

---

## Failure Summary

| Test # | Issue | Severity | Linked known-issue |
|---|---|---|---|
| | | | |

---

## Sign-off

☐ All P0/P1 tests passing
☐ No new P0 issues discovered
**Tester signature:** _______________
**Date completed:** _______________
