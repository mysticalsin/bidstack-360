// happy-dom 21 implements WAAPI `cancel()` by rejecting `animation.finished`
// with AbortError. Framer Motion does not attach a handler, so Vitest treats
// the rejection as unhandled after an otherwise-passing unmount. Attach a
// no-op catch before cancel so the patched DOM stays spec-shaped without
// failing the suite.
if (typeof Animation !== 'undefined') {
  const originalCancel = Animation.prototype.cancel;
  Animation.prototype.cancel = function cancel(this: Animation) {
    void this.finished.catch(() => undefined);
    return originalCancel.call(this);
  };
}
