export interface StartSyncInput {
  orgId: string;
  userId: string;
  idempotencyKey: string;
}

export class SyncNotFoundError extends Error {
  constructor() {
    super('Sync run not found');
    this.name = 'SyncNotFoundError';
  }
}

/** The source cannot run (not connected, missing setup); maps to 400. */
export class SyncUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncUnavailableError';
  }
}
