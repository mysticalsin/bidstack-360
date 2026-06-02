# Custom Object Field Namespacing

## Problem

Custom object definitions bootstrap standard fields like `name`, `owner`, and `created_date`.
The current database uniqueness constraint on custom field definitions is scoped to
`(orgId, entityType, fieldKey)`, so using the same `entityType = CUSTOM_OBJECT` for every custom
object causes the second custom object to fail when it tries to create its own standard fields.

## Solution

Namespace custom object field definitions by object id:

- New fields use `CUSTOM_OBJECT:<customObjectDefId>` as `entityType`.
- Field reads accept both the legacy `CUSTOM_OBJECT` namespace and the new scoped namespace.
- Create-to-list UI flows cancel stale custom-object list queries, upsert the mutation response, refetch, and upsert again so in-flight reads cannot hide the newly created object.
- E2E assertions should use the custom object card `data-testid` derived from the created object key, not broad text matching that also hits derived API keys.

## Follow-Up

A future generated Prisma migration should replace the legacy uniqueness shape with an explicit custom-object-aware constraint. Do not hand-edit old migrations.
