/** @file A stand-in for a browser's media playback, which jsdom doesn't do. */

/**
 * Stand in for a browser's media playback on `element`: time moves only when the test
 * says, play and pause take effect at once, and each pause and each new file is counted.
 */
export function fakeMedia(element: HTMLAudioElement) {
  let time = 0;
  let paused = true;
  let loads = 0;
  let pauses = 0;
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  Object.defineProperties(element, {
    currentTime: {
      get: () => time,
      set: (seconds: number) => {
        time = seconds;
      },
    },
    duration: { get: () => 600 },
    paused: { get: () => paused },
    src: {
      get: () => src?.get?.call(element) as string,
      set: (url: string) => {
        src?.set?.call(element, url);
        loads++;
        time = 0;
        queueMicrotask(() => element.dispatchEvent(new Event("loadedmetadata")));
      },
    },
  });
  element.play = () => {
    paused = false;
    element.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  element.pause = () => {
    pauses++;
    paused = true;
    element.dispatchEvent(new Event("pause"));
  };
  return {
    /** Play on to `seconds` into the file. */
    playTo(seconds: number) {
      time = seconds;
      element.dispatchEvent(new Event("timeupdate"));
    },
    get loads() {
      return loads;
    },
    get pauses() {
      return pauses;
    },
  };
}
