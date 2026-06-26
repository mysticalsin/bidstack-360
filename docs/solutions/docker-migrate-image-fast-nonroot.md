# Docker migrate image fast non-root path

## Problem

The one-shot migration image must be safe to run before app rollout, but it
should not depend on the full product build. The previous `migrate` target
copied Prisma files from the full `builder` stage, which forced web/API/worker
builds before a schema-only migration job could be produced.

That made the target slow enough to time out locally and obscured whether the
runtime job itself was healthy.

## Pattern

Keep the migration job minimal:

- Build from a dedicated Node Alpine target, not the full product `builder`.
- Copy only `packages/db/prisma` from the build context.
- Create and use a non-root runtime user.
- Run Prisma directly from `packages/db/node_modules/.bin/prisma`.
- Avoid `pnpm` in the runtime `CMD`; Corepack can try to download pnpm when the
  non-root runtime user lacks the prepared cache.
- Remove global npm/Corepack/pnpm trees after install. The migration runtime
  starts from the package-local Prisma binary, so shipping package managers only
  increases vulnerability-scan surface.

## Gate

```powershell
docker build --pull=false --progress=plain --target migrate -f Dockerfile -t bidcrm-migrate:nonroot-probe .
docker image inspect bidcrm-migrate:nonroot-probe --format '{{.Id}} {{.Config.User}} {{.Config.WorkingDir}} {{json .Config.Cmd}}'
docker run --rm -e DATABASE_URL=postgres://example:example@example.invalid:5432/example bidcrm-migrate:nonroot-probe ./packages/db/node_modules/.bin/prisma validate --schema packages/db/prisma/schema.prisma
docker run --rm --network bidcrm_default -e DATABASE_URL=postgres://bidstack:bidstack@postgres:5432/bidstack bidcrm-migrate:nonroot-probe
```

## Verification Snapshot

2026-06-17 local deploy-image proof:

- Build: `docker build --target migrate` completed without the full `builder`
  stage.
- Image id: `sha256:7f9d43ee37b969a0d141544d297939359e5dbffbf6cb04644d42f14f797987f1`.
- Runtime user: `bidstack`.
- Working dir: `/app`.
- CMD:
  `["./packages/db/node_modules/.bin/prisma","migrate","deploy","--schema","packages/db/prisma/schema.prisma"]`.
- Global npm/Corepack trees: removed.
- Prisma schema validation: pass.
- Local Compose Postgres migration deploy: pass, `65 migrations found`, `No pending migrations to apply`.
- `pnpm security:scan`: pass after Dockerfile change, 1381 mirrored files, 0 blocking findings.
- `BIDSTACK_CONTAINER_SCAN_IMAGES=bidcrm-migrate:nonroot-probe pnpm container:scan`:
  pass, `CRITICAL:0 HIGH:0`.

## Guardrails

Do not reintroduce `COPY --from=builder` into the `migrate` target unless the
migration command truly requires compiled app artifacts. Prisma `migrate deploy`
requires the schema/migrations and database URL, not the web/API/worker build.

Do not use `pnpm --filter @bidstack/db migrate:deploy` as the container `CMD`.
It is convenient locally, but the runtime image should not need package-manager
bootstrap or network access just to apply migrations.
