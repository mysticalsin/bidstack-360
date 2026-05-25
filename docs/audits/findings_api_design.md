# API Design & Contracts Audit Findings

## Findings
| ID | Severity | Location | Finding | Fix Effort |
|---|---|---|---|---|
| API-1 | Medium | `apps/api/src/routes/contacts.ts`:L63 | Missing unique tie-breaker (`id`) in `orderBy: { createdAt: 'desc' }` for cursor pagination, which can cause duplicate or skipped records when `createdAt` values collide. | Low |
| API-2 | Medium | `apps/api/src/routes/tasks.ts`:L26 | Missing unique tie-breaker (`id`) in `orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }]` for cursor pagination. | Low |
| API-3 | Medium | `apps/api/src/routes/companies.ts`:L84 | Missing unique tie-breaker (`id`) in `orderBy: { createdAt: 'desc' }` for cursor pagination. | Low |
| API-4 | High | `apps/api/src/routes/accounts.ts`:L15, L98, L186, L261 | Entire `response` blocks (and sometimes the whole `schema`) are missing from `GET /accounts/key`, `GET /accounts/top`, `PATCH /companies/:id/tier`, and `GET /accounts/industries`. Fastify will not validate or serialize responses. | Low |
| API-5 | Medium | `apps/api/src/routes/dust-integration.ts`:L341 | `DELETE /api-keys/:id` lacks a `response: { 204: z.null() }` schema definition. | Low |
| API-6 | Medium | `apps/api/src/routes/files.ts`:L254 | `DELETE /files/:id` lacks a `response: { 204: z.null() }` schema definition. | Low |
| API-7 | Low | `apps/api/src/routes/companies.ts`:L56-L64 | `querystring` and `response` schemas for `GET /companies` are defined inline instead of in `packages/shared/src/schemas/company.ts` (`CompanyFilter`, `CompanyPage`). | Low |
| API-8 | Low | `apps/api/src/routes/accounts.ts`:L16, L99, L188 | `querystring` and `body` schemas are defined inline rather than being extracted to shared schemas. | Low |
| API-9 | Low | `apps/api/src/routes/dust-integration.ts`:L373-L386 | `GET /webhooks` response schema is defined inline instead of a shared `SyncEventPage` schema. | Low |
| API-10 | Medium | `handoff/openapi.yaml`:L45 vs `opportunities.ts`:L372 | Mismatch: Fastify `POST /opportunities/:id/stage` returns `{ id, stage }`, but OpenAPI defines an empty response (`description: ok`). | Low |
| API-11 | Medium | `handoff/openapi.yaml`:L56-L57 | Mismatch: OpenAPI spec for `/api/contacts` and `/api/tasks` lack response payload schema definitions entirely (only specify `description: ok`), whereas Fastify implements full `ContactPage` / `TaskPage` schemas. | Low |
| API-12 | Low | `handoff/openapi.yaml`:L10-L75 vs `opportunities.ts` | Mismatch: OpenAPI spec is missing definitions for `GET /api/opportunities/count` and `POST /api/opportunities/import` which exist in the Fastify routes. | Low |

### Final Score: 7/10
The API contracts have a solid foundation utilizing Zod and Fastify, but there are notable gaps in cursor pagination stability (missing unique tie-breakers) and some routes completely missing response validation schemas. The inline schemas break the DRY principle and the `@bidstack/shared` convention. Finally, the OpenAPI documentation is out of sync with actual implementations, particularly on returning payloads and newly added routes.
