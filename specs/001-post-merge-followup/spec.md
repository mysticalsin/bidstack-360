# Feature Specification: Post-merge import and audit follow-up

**Feature Branch**: `cursor/post-merge-followup-a111`
**Created**: 2026-11-12
**Status**: Draft
**Input**: Follow-up after PR 343 merged to main at `e88aa902` (head `110a4fc8`). Production deploy is watched separately and is out of scope.

## User Scenarios & Testing

### User Story 1 — One bad import does not stall the reaper (Priority: P1)

An operator leaves several imports pending after a queue failure. The sweep removes each abandoned import and records that it did so. If deleting one of them raises, the sweep records the failure for that import and continues with the rest. A later scan can try the one that raised. It does not skip every import after it.

**Independent Test**: Two abandoned pending imports. A database trigger rejects the first delete and allows the second. One sweep reaps the second import and leaves the first pending, with no reap audit for the first.

**Acceptance Scenarios**:

1. **Given** two abandoned pending imports and a delete that raises for the first, **When** the sweep runs, **Then** the second import is removed, a reap audit exists for it, and the first import is still pending with no reap audit.
2. **Given** a delete that raises, **When** the sweep runs twice, **Then** it does not write a new reap row for the import that is still pending.

### User Story 2 — The deploy CLI tree is consistent (Priority: P1)

The pinned Railway and Vercel CLIs install from `deploy/cli`. `npm ls` in that directory exits 0. The versions Trivy flagged stay on the fixed releases. `railway --version` and `vercel --version` from the pinned resolver still start. No workflow is run and nothing is deployed.

**Independent Test**: After `npm ci --ignore-scripts`, `npm ls` exits 0, `npm audit` reports no vulnerabilities, and both CLIs print a version.

**Acceptance Scenarios**:

1. **Given** the `path-to-regexp` 8.x override, **When** the lockfile is installed, **Then** every 8.x copy is 8.4.2, which is the copy `@vercel/fun` already resolved, and `npm ls` does not report that package as invalid.
2. **Given** the other overrides, **When** audit runs, **Then** js-yaml, tar, undici, minimatch, path-to-regexp, busboy, smol-toml, glob, ajv, and zod stay on the fixed versions already chosen. `@railway/cli` stays 5.71.0 and vercel stays 65.14.0.

### User Story 3 — The app role cannot delete audit rows (Priority: P2)

The audit log is append-only for the application role. A migration revokes `DELETE` on `audit_log` from that role. The table owner used by today's process, and by the retention purge and the test teardown, is unchanged. Switching the running process onto the app role is a later cutover and is not part of this change.

**Independent Test**: As the app role, `DELETE FROM audit_log` is rejected. As the table owner, a delete still succeeds.

**Acceptance Scenarios**:

1. **Given** the migration has been applied, **When** the session uses the app role and deletes an audit row, **Then** Postgres rejects it.
2. **Given** the same row, **When** the table owner deletes it, **Then** the delete succeeds.

### User Story 4 — A chunk for an already-failed attempt is quiet (Priority: P2)

A chunk whose attempt is the one already stored on a failed import is done. The worker logs that it skipped the chunk and returns. It does not throw, so the queue does not record a failure or print an error stack on every retry. A chunk that carries a newer attempt than the failed row is still waiting for the retry claim, and that chunk still throws "not running yet" so it is retried rather than acknowledged.

**Independent Test**: A failed import whose stored attempt matches the chunk resolves without reading rows. The same import with a newer attempt id on the chunk still rejects.

**Acceptance Scenarios**:

1. **Given** a failed import and a chunk with the same attempt id, **When** the worker processes the chunk, **Then** it returns without reading rows and without throwing.
2. **Given** a failed import and a chunk with a different attempt id, **When** the worker processes the chunk, **Then** it throws "not running yet" and does not read rows.

### User Story 5 — One start action is one import (Priority: P1)

A CSV start creates one import record for one action. The web client sends an `Idempotency-Key` that stays the same while that action is unsettled, including a second attempt of the same action, and is a new key after the action settles. Two processes that post the same body at the same time without a key also get one record: the second request is refused while the first is in flight and does not insert a row. When the first request finishes, a later start of the same file is a new import. A missing key is not stored for the 24-hour replay.

**Independent Test**: The start hook sends one key for two overlapping calls and a different key after they settle. Two concurrent start requests with no key return 201 and 409 and leave one `migration_job`. A third request after those finish returns 201.

**Acceptance Scenarios**:

1. **Given** a start that has not settled, **When** the client sends that start again, **Then** both requests carry the same `Idempotency-Key` of at least 8 characters.
2. **Given** that start has settled, **When** the client starts again, **Then** the new request carries a different key.
3. **Given** two concurrent start requests with the same body and no key, **When** both are handled, **Then** one returns 201, the other returns 409, and one import row exists.
4. **Given** the in-flight request has finished, **When** the same body is posted again with no key, **Then** that start returns 201 and creates a second import.

### User Story 6 — Redis comes back without a process restart (Priority: P1)

Redis can be unreachable for longer than the old five reconnect attempts. The API client and the migrations queue connection keep reconnecting, with the delay capped, and commands still fail immediately while the connection is down. When Redis accepts connections again, a CSV start on the same process succeeds. A connection that has already stopped is started again before the start uses it.

**Independent Test**: A client and its duplicate, using the process retry delay, stay able to reconnect after the socket is down for longer than the old five-attempt budget, and both answer `PING` after the socket returns, without a manual `connect()`. A start whose queue connection was closed succeeds on the next request.

**Acceptance Scenarios**:

1. **Given** the retry delay, **When** the attempt count is past five, **Then** the delay is still a number and never asks the client to stop, and it never exceeds the cap.
2. **Given** a client and the queue's duplicate connection lose the socket for longer than the old give-up, **When** the socket accepts connections again, **Then** both answer a command without the process being restarted.
3. **Given** the queue connection is already closed, **When** a CSV start runs, **Then** it reconnects that connection and returns 201.

## Requirements

### Functional Requirements

- **FR-001**: `sweepAbandonedPending` catches an error from one candidate and continues with the next candidate.
- **FR-002**: A candidate whose delete raises gets no `migration.reaped` row.
- **FR-003**: The deploy CLI override for `path-to-regexp` 8.x is 8.4.2. The lockfile is regenerated. `npm ls` in `deploy/cli` exits 0.
- **FR-004**: A migration creates the app role if it is missing and revokes `DELETE` on `audit_log` from that role. It does not revoke `DELETE` from the table owner.
- **FR-005**: A chunk for a failed import is skipped when its attempt id is the attempt stored on the row, or when the row has no attempt id. A chunk with a different attempt id still throws while the row is `FAILED`. A chunk for a `PENDING` row still throws.
- **FR-006**: Commit subjects name the change. No published commit is amended. Nothing in this slice rewrites `110a4fc8`.
- **FR-007**: `useStartCsvImport` sends `Idempotency-Key`. The key is stable for one unsettled start and new after it settles. When the header is absent, `start-csv` holds an in-flight lock on the org and the request body, refuses the concurrent request with 409, and creates no second `migration_job`. The lock is released when the request ends. A missing key is not written to the 24-hour replay cache.
- **FR-008**: The Redis retry delay never stops the client. The delay is capped. Commands stay fail-fast (`maxRetriesPerRequest` 1, no offline queue). The migrations queue connection uses that same delay. `start-csv` waits until the process client and the queue connection can run a command, and a connection that has already stopped is connected again before the start uses it.

## Success Criteria

- **SC-001**: The two-import sweep test fails before the per-job catch exists, and passes after.
- **SC-002**: `npm ls` and `npm audit` in `deploy/cli` exit 0, and both pinned CLIs print a version.
- **SC-003**: The app-role delete test fails before the migration and passes after.
- **SC-004**: The same-attempt failed chunk test fails before the quiet skip and passes after, and the newer-attempt test still rejects.
- **SC-005**: The start hook test fails before the key is sent, and passes after. The concurrent no-key start test fails with two import rows before the in-flight lock, and passes with one row after.
- **SC-006**: The socket-drop test ends the client after the old five-attempt budget before the delay change, and both connections answer `PING` after the socket returns once the delay no longer stops. The closed queue connection test fails the next start before the readiness path, and that start returns 201 after.

## Out of Scope

- Production deploy, `deploy.yml` changes, and changing which database user the API and worker connect as.
- A `DELETE` trigger on `audit_log`, `REVOKE` from the table owner, and a scheduled chain verifier.
- Rewriting commit subjects on `main`.
- Replaying a start that omitted `Idempotency-Key` for 24 hours.
- BullMQ attempt counts, stall intervals, and the abandoned-import reaper.
