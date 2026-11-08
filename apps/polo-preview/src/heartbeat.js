// Client-side liveness for the box relay socket. A sleeping laptop or a
// dropped network leaves a half-open socket that never fires `close`, so the
// client pings and terminates the socket when nothing arrives in time.

// The Worker closes a relay socket silent for 35s, so ping well inside that.
export function createHeartbeat({ send, terminate, intervalMs = 10_000, timeoutMs = 30_000 }) {
  let timer = null;
  let lastSeen = 0;
  return {
    start() {
      lastSeen = Date.now();
      timer = setInterval(() => {
        if (Date.now() - lastSeen > timeoutMs) {
          clearInterval(timer);
          timer = null;
          terminate();
          return;
        }
        send('ping');
      }, intervalMs);
    },
    onPong() {
      lastSeen = Date.now();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export function reconnectDelayMs(attempt) {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}
