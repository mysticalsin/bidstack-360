# QA & Testing Audit Findings

## Findings
| ID | Severity | Location | Finding | Fix Effort |
|---|---|---|---|---|
| QA-05 | High | `apps/api/src/routes/**/*.test.ts` | API integration tests use `skipIfNoDb` to silently abort and skip tests if the local database isn't reachable (e.g. `contacts.integration.test.ts:48`). This violates Rule 12 (Fail loud). | Low |
| QA-02 | High | `apps/web/src/pages/` | Most React components and page controllers still lack unit tests. `OpportunitiesPage.test.tsx` was added, but the majority of pages (e.g., AccountsPage, LeadsPage, ContactsPage) remain untested. | High |
| QA-07 | Medium | E2E tests, `apps/api/src/plugins/auth.test.ts` | Complete lack of real Clerk authentication testing. Tests rely entirely on the dev-mode auth stub, leaving production JWT validation and login UI flows entirely untested. | High |
| QA-08 | Medium | `apps/api/src/routes/crm/companies.test.ts:55` | Tests assert basic behavior (`Array.isArray(body.items)`) instead of business intent, tightly coupling to unpredictable global seed data rather than isolating test setup (Rule 9). | Medium |
| QA-09 | Low | `apps/api/src/routes/dust-integration.test.ts:30` | Mocking Dust relies on mutating global `process.env` properties in `beforeAll` instead of proper HTTP network mocking (e.g., MSW/Nock), making tests fragile. | Medium |

### Fixed Issues Since Last Audit
- **QA-01 (Critical):** E2E suite silently skipping on API unreachable has been fixed in `fixtures.ts:44` by explicitly throwing an error (Rule 12).
- **QA-03 (High):** E2E tests using tautologies (e.g. `contacts.spec.ts`) have been replaced with explicit hard assertions, fixing Rule 9 violations.
- **QA-04 (High):** Brittle conditional skips in E2E tests (`opportunities.spec.ts`, `smoke.spec.ts`) have been removed and replaced with robust visibility waits.
- **QA-06 (High):** Worker queue tests no longer silently return if Redis is unreachable; they now throw a hard error in `beforeAll`.

### Final Score
**5 / 10**

### Summary
The QA domain has seen significant improvements, especially in E2E stability and enforcing Rule 12 (Fail loud) for Playwright test initialization and worker queues. However, the API test suite still relies on the anti-pattern of silently skipping tests when the DB is unavailable. Furthermore, unit testing for complex React components remains sparse, and external integrations (Clerk, Dust) lack proper mocking and isolation.
