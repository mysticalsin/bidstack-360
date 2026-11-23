/**
 * happy-dom 21 implements the Web Animations API. Cancelling an animation
 * rejects its `finished` promise with AbortError, and nothing in
 * framer-motion catches that promise, so Vitest reports an unhandled
 * rejection after otherwise-passing tests. Attach the catch before cancel
 * runs. Browsers do not fail the suite this way; this is the test runtime.
 */
if (typeof Animation !== 'undefined') {
  const original = Animation.prototype.cancel;
  Animation.prototype.cancel = function cancel(this: Animation) {
    void this.finished?.catch(() => undefined);
    return original.call(this);
  };
}
