# STACK_CHOICES.md

2026 best-in-class reference for greenfield projects. Use when no
incumbent stack exists. Verify currency before adopting — tooling
shifts fast. Last reviewed: May 2026.

Record the actual choice in `STACK.md`. This file is reference only.

---

## TypeScript / JavaScript

- **Runtime:** Bun (greenfield, fastest), Node 22+ (broad compat)
- **Package manager:** Bun (if Bun runtime), pnpm (monorepos, production standard), npm 11 (defaults)
- **Web framework:** Next.js (full-stack), Astro (content), SvelteKit (lean), React Router 7
- **Server framework:** Hono (edge), Fastify (Node), Bun.serve / Elysia (Bun)
- **ORM:** Drizzle (typed, light), Prisma (mature), Kysely (query builder)
- **Database:** Postgres (Neon, Supabase, RDS), SQLite (Turso, libSQL)
- **Styling:** Tailwind v4
- **Test:** Vitest (unit), Playwright (E2E)
- **Bundler:** Vite, Turbopack, Bun
- **Validation:** Zod, Valibot, ArkType

## Python

- **Project + package manager:** uv (Astral; ~10–100× faster than pip; OpenAI acquired Astral in March 2026)
- **Web framework:** FastAPI (async, OpenAPI), Litestar (DI-first)
- **Linter + formatter:** ruff (replaces black + flake8 + isort + more)
- **Type checker:** ty (Astral, new) or pyright
- **Test:** pytest
- **Validation:** Pydantic v2
- **Data:** Polars > pandas for new code; DuckDB for local analytics

## Go

- Standard toolchain; modules; `go test`; `golangci-lint`

## Rust

- Cargo; `cargo nextest`; `clippy`; `rustfmt`

## Mobile

- React Native + Expo (cross-platform), Swift / Kotlin (native), Tamagui (RN UI)

## Infra

- Terraform or Pulumi (IaC)
- Docker + Kubernetes (large scale) or Fly.io / Railway (smaller)
- GitHub Actions

## What to skip in 2026

- Yarn (Classic and Berry) — losing mindshare to pnpm and Bun
- pip + virtualenv as primary workflow — use uv
- black + flake8 + isort separately — use ruff
- Jest for new TS projects — use Vitest
- Cypress for new E2E — use Playwright
- mypy as the only type checker for new projects — try ty or pyright

---

These are starting points, not endorsements. Choose based on the
problem, the team, and the constraints. Re-review this file every
six months — tooling moves.
