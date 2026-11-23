// One automatic report and one automatic reload per crash signature.
// sessionStorage survives the reload, so the next paint of the same crash
// stays on the fallback instead of restarting forever. An in-memory set
// covers the same document when storage is blocked — in that case we still
// report once and refuse to reload, because a reload we cannot remember
// would loop.

const REPORTED_PREFIX = 'bidstack.crash.reported.';
const RELOADED_PREFIX = 'bidstack.crash.reloaded.';

const memoryReported = new Set<string>();
const memoryReloaded = new Set<string>();

export function crashSignature(message: string, stack: string, route: string): string {
  const frame =
    stack
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  const raw = `${message}\n${frame}\n${route}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = Math.imul(hash, 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function consumeCrash(
  signature: string,
  storage: Storage | null,
): { report: boolean; reload: boolean } {
  const report = claim(memoryReported, storage, `${REPORTED_PREFIX}${signature}`, signature);
  const reload = claim(memoryReloaded, storage, `${RELOADED_PREFIX}${signature}`, signature);
  return {
    report: report.claimed,
    // Only reload when the "already reloaded" flag will still be there after
    // the navigation. Otherwise the next load looks like a first crash.
    reload: reload.claimed && reload.persisted,
  };
}

export function resetCrashGuardForTests(): void {
  memoryReported.clear();
  memoryReloaded.clear();
}

function claim(
  memory: Set<string>,
  storage: Storage | null,
  key: string,
  signature: string,
): { claimed: boolean; persisted: boolean } {
  if (memory.has(signature) || readFlag(storage, key)) {
    memory.add(signature);
    return { claimed: false, persisted: true };
  }
  memory.add(signature);
  return { claimed: true, persisted: writeFlag(storage, key) };
}

function readFlag(storage: Storage | null, key: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(storage: Storage | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}
