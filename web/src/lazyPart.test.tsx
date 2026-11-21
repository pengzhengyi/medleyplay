import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PartLoadError, RETRY_AFTER_MS, lazyPart, preloadWhenIdle } from "./lazyPart";

/** What a part shows once loaded. */
function Greeting({ name }: { readonly name: string }) {
  return <p>Hello, {name}</p>;
}

/** A load that fails the first `failures` times, then gives `Greeting`. */
function loadFailing(failures: number) {
  let calls = 0;
  return vi.fn(() => {
    calls += 1;
    return calls <= failures
      ? Promise.reject(new TypeError("Failed to fetch dynamically imported module"))
      : Promise.resolve(Greeting);
  });
}

/** A load the test finishes itself. */
function loadHeld() {
  let finish: () => void = () => undefined;
  const load = vi.fn(
    () =>
      new Promise<typeof Greeting>((resolve) => {
        finish = () => {
          resolve(Greeting);
        };
      }),
  );
  return {
    load,
    finish: () => {
      finish();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a part loaded when it is first needed", () => {
  it("loads its code once however often it is preloaded", async () => {
    const load = loadFailing(0);
    const part = lazyPart(load);

    await Promise.all([part.preload(), part.preload()]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows what it waits in until its code arrives, then the part", async () => {
    vi.useRealTimers();
    const part = lazyPart(loadFailing(0));

    render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Ada" />
      </Suspense>,
    );

    expect(screen.getByText("Opening…")).toBeInTheDocument();
    expect(await screen.findByText("Hello, Ada")).toBeInTheDocument();
  });

  it("tries a failed load once more, a moment later", async () => {
    const load = loadFailing(1);
    const part = lazyPart(load);

    const loading = part.preload();
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS);

    await expect(loading).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second failure, saying the part did not load", async () => {
    const part = lazyPart(loadFailing(2));

    const loading = part.preload();
    const failed = expect(loading).rejects.toBeInstanceOf(PartLoadError);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS);

    await failed;
  });

  it("forgets a load that failed, so the next attempt loads afresh", async () => {
    const load = loadFailing(2);
    const part = lazyPart(load);
    const first = part.preload().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS);
    await first;

    await part.preload();

    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("loading parts while the browser is idle", () => {
  it("loads each part in turn, each when the browser is next idle", async () => {
    const first = loadHeld();
    const second = loadHeld();
    preloadWhenIdle([lazyPart(first.load), lazyPart(second.load)], new AbortController().signal);

    await vi.advanceTimersByTimeAsync(1000);
    expect([first.load.mock.calls.length, second.load.mock.calls.length]).toEqual([1, 0]);
    first.finish();
    await vi.advanceTimersByTimeAsync(1000);

    expect([first.load.mock.calls.length, second.load.mock.calls.length]).toEqual([1, 1]);
  });

  it("goes on to the next part when one fails to load", async () => {
    const next = loadFailing(0);
    preloadWhenIdle([lazyPart(loadFailing(2)), lazyPart(next)], new AbortController().signal);

    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 2000);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("loads nothing more once stopped", async () => {
    const first = loadHeld();
    const second = loadHeld();
    const stop = new AbortController();
    preloadWhenIdle([lazyPart(first.load), lazyPart(second.load)], stop.signal);
    await vi.advanceTimersByTimeAsync(1000);

    stop.abort();
    first.finish();
    await vi.advanceTimersByTimeAsync(1000);

    expect(second.load).not.toHaveBeenCalled();
  });
});
