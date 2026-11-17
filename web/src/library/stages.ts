/**
 * @file When the reads after the first one run, so the songs reach the page first.
 *
 * The server answers one request at a time quickly, and many at once slowly: reads sent
 * together with the songs' make the songs wait for them. So the page reads its songs
 * first, what it shows around them once they are drawn, and what only some views need
 * when the browser is idle.
 */

/** How long a read waits for the browser to be idle, at most, in milliseconds. */
const IDLE_WITHIN_MS = 2000;

/** Run `work` once the frame being drawn now is on screen; return a way to cancel it. */
export function afterNextPaint(work: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(work, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

/** Run `work` when the browser is idle, or within two seconds; return a way to cancel it. */
export function whenIdle(work: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const idle = requestIdleCallback(work, { timeout: IDLE_WITHIN_MS });
    return () => {
      cancelIdleCallback(idle);
    };
  }
  // Safari has no idle callback: a short wait still lets the songs' read go first.
  const timer = setTimeout(work, 300);
  return () => {
    clearTimeout(timer);
  };
}
