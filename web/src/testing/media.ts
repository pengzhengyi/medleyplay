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

/**
 * Stand in for the system's media keys and audio devices, which jsdom doesn't have:
 * `press` sends a Media Session action as the system does, and `changeDevices` says an
 * audio device came or went, as taking out earbuds does. A page that isn't `secure`, such
 * as one over plain HTTP, is told of no devices. `restore` takes both away.
 */
export function fakeSystemMedia({ secure = true }: { readonly secure?: boolean } = {}) {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler>();
  const devices = new EventTarget();
  const session = {
    metadata: null,
    playbackState: "none",
    setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
      if (handler === null) {
        handlers.delete(action);
      } else {
        handlers.set(action, handler);
      }
    },
    setPositionState() {
      // The system's own display of the position isn't stood in for.
    },
  };
  Object.defineProperty(navigator, "mediaSession", { configurable: true, value: session });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: secure ? devices : undefined,
  });
  Object.defineProperty(globalThis, "MediaMetadata", {
    configurable: true,
    value: class {
      constructor(readonly init?: MediaMetadataInit) {}
    },
  });
  return {
    press(action: MediaSessionAction) {
      handlers.get(action)?.({ action });
    },
    changeDevices() {
      devices.dispatchEvent(new Event("devicechange"));
    },
    restore() {
      Reflect.deleteProperty(navigator, "mediaSession");
      Reflect.deleteProperty(navigator, "mediaDevices");
      Reflect.deleteProperty(globalThis, "MediaMetadata");
    },
  };
}
