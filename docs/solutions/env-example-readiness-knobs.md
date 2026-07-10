# Env Example Readiness Knobs

When a production-readiness fix adds or relies on a fail-closed runtime knob,
update `.env.example` in the same slice. The example file is the operator-facing
contract for deploys, not only a local-dev convenience.

For high-risk controls, document:

- the default value and whether production should keep it;
- what risk the knob controls;
- when it is acceptable to disable or relax it;
- whether the value belongs in a secret manager;
- what separate live evidence is still required.

In this repo, these readiness knobs must remain visible in `.env.example`:

- `OPENAPI_DOCS_ENABLED`
- `RATE_LIMIT_REDIS_REQUIRED`
- `QUERY_GUARD_REJECT`
- `BIDSTACK_TENANT_SCOPE_GUARD`
- `BACKUP_S3_BUCKET`
- `BACKUP_ENCRYPT_KEY`

Presence alone is not enough. The comments must tell an operator what happens
in production and what proof closes the related release gate.
