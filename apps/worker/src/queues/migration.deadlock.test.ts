// WHY: a Prisma company insert reports a deadlock with no error code. A
// classifier that only reads `.code` stores the driver text, process ids, and
// transaction ids on the job. The match is the driver record's code field,
// not a search for those digits anywhere in the message.

import { Prisma } from '@bidstack/db';
import { describe, expect, it } from 'vitest';

import { isMigrationDeadlock } from './migration.js';

const DRIVER_40P01 = `
Invalid \`prisma.company.create()\` invocation:

Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "deadlock detected", severity: "ERROR", detail: Some("Process 156345 waits for ShareLock on transaction 1329; blocked by process 156346.\\nProcess 156346 waits for ShareLock on transaction 1328; blocked by process 156345."), column: None, hint: Some("See server log for query details.") }), transient: false })`;

const DRIVER_40001 = DRIVER_40P01.replace('40P01', '40001').replace(
  'deadlock detected',
  'could not serialize access due to concurrent update',
);

describe('deadlock classification', () => {
  it('recognises a codeless Prisma company insert deadlock', () => {
    const err = new Prisma.PrismaClientUnknownRequestError(DRIVER_40P01, {
      clientVersion: '5.22.0',
    });
    expect(err.code).toBeUndefined();
    expect(isMigrationDeadlock(err)).toBe(true);
  });

  it('recognises a serialization failure and a Prisma transaction conflict', () => {
    const serial = new Prisma.PrismaClientUnknownRequestError(DRIVER_40001, {
      clientVersion: '5.22.0',
    });
    const wrapped = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction.',
      { code: 'P2034', clientVersion: '5.22.0' },
    );
    const raw = new Prisma.PrismaClientKnownRequestError('raw', {
      code: 'P2010',
      clientVersion: '5.22.0',
      meta: { code: '40001' },
    });
    expect(isMigrationDeadlock(serial)).toBe(true);
    expect(isMigrationDeadlock(wrapped)).toBe(true);
    expect(isMigrationDeadlock(raw)).toBe(true);
    expect(isMigrationDeadlock({ cause: serial })).toBe(true);
  });

  it('does not treat a nearby 40P01 or a unique violation as a deadlock', () => {
    expect(isMigrationDeadlock(new Error('company 40P01'))).toBe(false);
    expect(
      isMigrationDeadlock(new Error('failed at apps/worker/src/queues/migration.ts:236:40')),
    ).toBe(false);
    const unique = new Prisma.PrismaClientUnknownRequestError(
      DRIVER_40P01.replace('40P01', '23505'),
      { clientVersion: '5.22.0' },
    );
    expect(isMigrationDeadlock(unique)).toBe(false);
  });
});
