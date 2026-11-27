const WINDOW = 16;
const SLOW_FRAMES = 12;
const SLOW_INTERVAL_MS = 40;

export function framePacing() {
  const intervals = Array<boolean>(WINDOW).fill(false);
  let previous: number | undefined;
  let cursor = 0;
  let count = 0;
  let slowCount = 0;
  return {
    slowAt(now: number): boolean {
      const last = previous;
      previous = now;
      if (last === undefined) return false;
      if (intervals[cursor]) slowCount -= 1;
      const slow = now - last > SLOW_INTERVAL_MS;
      intervals[cursor] = slow;
      if (slow) slowCount += 1;
      cursor = (cursor + 1) % WINDOW;
      count = Math.min(WINDOW, count + 1);
      return count === WINDOW && slowCount >= SLOW_FRAMES;
    },
    reset() {
      previous = undefined;
      intervals.fill(false);
      cursor = 0;
      count = 0;
      slowCount = 0;
    },
  };
}
