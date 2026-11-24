/**
 * Stop a failed upstream response without keeping the bytes.
 *
 * Cancel the stream first. If there is no cancel, read at most 64 KiB.
 * Either way the work stops within 2 seconds and never throws. Provider
 * bodies can carry tokens, mailbox text, or customer ids.
 */
const BODY_CAP_BYTES = 64 * 1024;
const BODY_BOUND_MS = 2_000;

type Reader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: () => void | Promise<void>;
};

export async function discardUpstreamBody(res: {
  body?: {
    cancel?: () => void | Promise<void>;
    getReader?: () => Reader;
  } | null;
  text?: () => Promise<string>;
}): Promise<void> {
  const started = Date.now();
  const left = () => Math.max(0, BODY_BOUND_MS - (Date.now() - started));
  try {
    const cancel = res.body?.cancel;
    if (typeof cancel === 'function') {
      await raceTimeout(Promise.resolve(cancel.call(res.body)).catch(() => undefined), left());
      return;
    }
    const getReader = res.body?.getReader;
    if (typeof getReader === 'function') {
      await readCapped(getReader.call(res.body), left);
      return;
    }
    if (typeof res.text === 'function') {
      await raceTimeout(
        Promise.resolve()
          .then(() => res.text!())
          .catch(() => ''),
        left(),
      );
    }
  } catch {
    // A provider stream must not become the caller's error.
  }
}

function raceTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

async function readCapped(reader: Reader, left: () => number): Promise<void> {
  const timer = setTimeout(() => {
    void Promise.resolve(reader.cancel()).catch(() => undefined);
  }, left());
  try {
    let total = 0;
    while (total < BODY_CAP_BYTES) {
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('upstream body bound')), left());
        }),
      ]);
      if (next.done) break;
      total += next.value?.byteLength ?? 0;
    }
  } catch {
    // Bound hit, or the stream failed. Either way we stop.
  } finally {
    clearTimeout(timer);
    await Promise.resolve(reader.cancel()).catch(() => undefined);
  }
}
