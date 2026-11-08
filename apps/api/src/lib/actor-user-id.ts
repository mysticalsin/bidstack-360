const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Audit columns such as createdByUserId are PostgreSQL uuids. An API-key
 * session is `apikey:<id>`, which is not a user row. Those writes store null
 * instead of failing the insert. A human session stores the user id.
 */
export function actorUserId(userId: string | null | undefined): string | null {
  if (!userId || userId.startsWith('apikey:')) return null;
  return USER_UUID.test(userId) ? userId : null;
}
