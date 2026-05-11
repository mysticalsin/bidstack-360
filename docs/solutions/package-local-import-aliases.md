# Package-Local Import Aliases

## Problem

The web app defines the `@/*` alias in its own TypeScript config, but sibling packages do not inherit that alias automatically. Copying a web-style `@/redis` import into the API package passes only if every tool in that package has a matching resolver. Vitest failed because `apps/api` had no alias configured.

## Solution

Inside package-local source files, prefer the package's existing import convention. In `apps/api`, local imports use relative ESM paths with `.js` suffixes, such as `../redis.js`.

Only introduce an alias when all package toolchains are updated together: TypeScript, Vitest/Vite, ESLint import resolution if enabled, and runtime/bundler config.

## Prevention

Before using a path alias in a package, grep that package for existing alias usage and inspect its `tsconfig` and test config. A path alias belongs to the package that declares it, not to the whole monorepo by default.
