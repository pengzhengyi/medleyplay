import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PartLoadError, RETRY_AFTER_MS, lazyPart, preloadWhenIdle } from "./lazyPart";

/** What a part shows once loaded. */
function Greeting({ name }: { readonly name: string }) {
  return <p>Hello, {name}</p>;
}

/** An editable title starting as "First song", with a label the parent can change. */
function Draft({ label }: { readonly label: string }) {
  const [title, setTitle] = useState("First song");
  return (
    <input
      aria-label={label}
      value={title}
      onChange={(event) => {
        setTitle(event.currentTarget.value);
      }}
    />
  );
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

  it("shows a preloaded part immediately without its loading frame", async () => {
    const part = lazyPart(loadFailing(0));
    await part.preload();

    render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Ada" />
      </Suspense>,
    );

    expect(screen.getByText("Hello, Ada")).toBeInTheDocument();
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
  });

  it("keeps the loading frame until an unfinished preload arrives", async () => {
    const held = loadHeld();
    const part = lazyPart(held.load);
    const preloading = part.preload();
    render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Ada" />
      </Suspense>,
    );
    expect(screen.getByText("Opening…")).toBeInTheDocument();

    await act(async () => {
      held.finish();
      await preloading;
    });

    expect(screen.getByText("Hello, Ada")).toBeInTheDocument();
    expect(held.load).toHaveBeenCalledTimes(1);
  });

  it.each(["cold", "preloaded"])(
    "keeps edits, focus, and selection when the parent updates a %s part",
    async (opening) => {
      const part = lazyPart(() => Promise.resolve(Draft));
      if (opening === "preloaded") await part.preload();
      const { rerender } = render(
        <Suspense fallback={<p>Opening…</p>}>
          <part.Component label="Song title" />
        </Suspense>,
      );
      await act(async () => {
        await part.preload();
      });
      const input = screen.getByRole<HTMLInputElement>("textbox", { name: "Song title" });
      fireEvent.change(input, { target: { value: "My edited song" } });
      input.focus();
      input.setSelectionRange(3, 9);

      rerender(
        <Suspense fallback={<p>Opening…</p>}>
          <part.Component label="Edited title" />
        </Suspense>,
      );

      const updated = screen.getByRole<HTMLInputElement>("textbox", { name: "Edited title" });
      expect(updated).toHaveValue("My edited song");
      expect(updated).toHaveFocus();
      expect([updated.selectionStart, updated.selectionEnd]).toEqual([3, 9]);
    },
  );

  it("opens immediately after being closed while its code was loading", async () => {
    const held = loadHeld();
    const part = lazyPart(held.load);
    const { unmount } = render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Ada" />
      </Suspense>,
    );
    expect(screen.getByText("Opening…")).toBeInTheDocument();

    unmount();
    await act(async () => {
      held.finish();
      await part.preload();
    });
    render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Grace" />
      </Suspense>,
    );

    expect(screen.getByText("Hello, Grace")).toBeInTheDocument();
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
    expect(held.load).toHaveBeenCalledTimes(1);
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
    render(
      <Suspense fallback={<p>Opening…</p>}>
        <part.Component name="Ada" />
      </Suspense>,
    );

    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Hello, Ada")).toBeInTheDocument();
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
