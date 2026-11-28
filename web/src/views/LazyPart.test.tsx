import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, Suspense, useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_AFTER_MS, forgetFailedLoads, lazyPart } from "../lazyPart";
import { PartFrame } from "../partFrame";
import { DialogOpening } from "./DialogOpening";
import { LanguageSelect } from "./LanguageSelect";
import { LazyPart } from "./LazyPart";

/** What a part shows once loaded. */
function Greeting() {
  return <p>Hello</p>;
}

/** An editable song title whose label can change while the draft stays open. */
function Draft({ label }: { readonly label: string }) {
  const [title, setTitle] = useState("First song");
  return (
    <input
      aria-label={label}
      value={title}
      onChange={(event) => {
        setTitle(event.target.value);
      }}
    />
  );
}

/** A Greeting part whose shared module load is completed by the test. */
function heldPart() {
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
    part: lazyPart(load),
    load,
    finish: () => {
      finish();
    },
  };
}

/** A part whose code loads only once `reachable` is set, as after the network returns. */
function partBehindTheNetwork() {
  const network = { reachable: false };
  const load = vi.fn(() =>
    network.reachable
      ? Promise.resolve(Greeting)
      : Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  );
  return { part: lazyPart(load), network, load };
}

/** The page as the server sends it, naming the entry script `entry`. */
function pageNaming(entry: string): string {
  return `<!doctype html><html><head><script type="module" crossorigin src="${entry}"></script></head><body><div id="root"></div></body></html>`;
}

/** The server answers the page with `html`, or can't be reached when `html` is undefined. */
function servePage(html: string | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      html === undefined
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(html, { status: 200 })),
    ),
  );
}

/** Let the part's load fail twice, a retry apart. */
async function failToLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 10);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const entry = document.createElement("script");
  entry.type = "module";
  entry.src = "/assets/index-old.js";
  document.head.append(entry);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.querySelector("script[type=module]")?.remove();
});

describe("a part of the page loaded when it opens", () => {
  it("keeps neighboring content visible while the part shows its own loading frame", async () => {
    const held = heldPart();
    render(
      <LazyPart doing="Opening the list…">
        <p>Existing controls</p>
        <held.part.Component />
      </LazyPart>,
    );

    expect(screen.getByText("Existing controls")).toBeVisible();
    expect(screen.getByText("Opening the list…")).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      held.finish();
      await held.part.preload();
    });

    expect(screen.getByText("Hello")).toBeVisible();
    expect(screen.getByText("Existing controls")).toBeVisible();
    expect(screen.queryByText("Opening the list…")).not.toBeInTheDocument();
  });

  it("shares one load during StrictMode replay and keeps a pending frame current", async () => {
    const held = heldPart();
    const { rerender } = render(
      <StrictMode>
        <LazyPart doing="Opening the first…">
          <held.part.Component />
        </LazyPart>
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <LazyPart doing="Opening the second…">
          <held.part.Component />
        </LazyPart>
      </StrictMode>,
    );

    expect(screen.getByText("Opening the second…")).toBeVisible();
    expect(held.load).toHaveBeenCalledTimes(1);
    await act(async () => {
      held.finish();
      await held.part.preload();
    });
    expect(screen.getByText("Hello")).toBeVisible();
    expect(held.load).toHaveBeenCalledTimes(1);
  });

  it("uses completed code after closing an unfinished opening", async () => {
    const held = heldPart();
    const shown = (
      <LazyPart doing="Opening…">
        <held.part.Component />
      </LazyPart>
    );
    const { unmount } = render(shown);
    expect(screen.getByText("Opening…")).toBeVisible();

    unmount();
    await act(async () => {
      held.finish();
      await held.part.preload();
    });
    render(shown);

    expect(screen.getByText("Hello")).toBeVisible();
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
    expect(held.load).toHaveBeenCalledTimes(1);
  });

  it.each(["cold", "preloaded"])(
    "keeps drafts, focus and selection when a %s part's frame and props change",
    async (opening) => {
      const part = lazyPart(() => Promise.resolve(Draft));
      if (opening === "preloaded") await part.preload();
      const { rerender } = render(
        <LazyPart doing="Opening…">
          <part.Component label="Song title" />
        </LazyPart>,
      );
      const title = await screen.findByRole<HTMLInputElement>("textbox", { name: "Song title" });
      fireEvent.change(title, { target: { value: "My edited song" } });
      title.focus();
      title.setSelectionRange(3, 9);

      rerender(
        <LazyPart doing="Opening the list…" frame={() => null}>
          <part.Component label="Edited title" />
        </LazyPart>,
      );

      const updated = screen.getByRole<HTMLInputElement>("textbox", { name: "Edited title" });
      expect(updated).toBe(title);
      expect(updated).toHaveValue("My edited song");
      expect(updated).toHaveFocus();
      expect([updated.selectionStart, updated.selectionEnd]).toEqual([3, 9]);
    },
  );

  it("lets a loaded part's nested plain Suspense use its own fallback", async () => {
    const held = heldPart();
    function Parent() {
      return (
        <Suspense fallback={<p>Inner loading</p>}>
          <held.part.Component />
        </Suspense>
      );
    }
    const parent = lazyPart(() => Promise.resolve(Parent));
    await parent.preload();

    render(
      <LazyPart doing="Outer loading">
        <parent.Component />
      </LazyPart>,
    );

    expect(screen.getByText("Inner loading")).toBeVisible();
    expect(screen.queryByText("Outer loading")).not.toBeInTheDocument();
    await act(async () => {
      held.finish();
      await held.part.preload();
    });
    expect(screen.getByText("Hello")).toBeVisible();
  });

  it.each(["framed", "native"])(
    "keeps a failed %s opening cached across closing and reopening until Try again",
    async (path) => {
      servePage(undefined);
      const { part, network, load } = partBehindTheNetwork();
      const content =
        path === "native" ? (
          <PartFrame value={null}>
            <part.Component />
          </PartFrame>
        ) : (
          <part.Component />
        );
      const shown = <LazyPart doing="Opening…">{content}</LazyPart>;
      const { unmount } = render(shown);
      await failToLoad();
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach medleyplay");
      expect(load).toHaveBeenCalledTimes(2);

      unmount();
      network.reachable = true;
      render(shown);

      expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach medleyplay");
      expect(load).toHaveBeenCalledTimes(2);
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Hello")).toBeVisible();
      expect(load).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["framed", "native"])(
    "retries a failed background preload when first opened through the %s path",
    async (path) => {
      const { part, network, load } = partBehindTheNetwork();
      const failed = part.preload().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 10);
      await failed;
      expect(load).toHaveBeenCalledTimes(2);
      network.reachable = true;

      render(
        <LazyPart doing="Opening…">
          {path === "native" ? (
            <PartFrame value={null}>
              <part.Component />
            </PartFrame>
          ) : (
            <part.Component />
          )}
        </LazyPart>,
      );

      expect(await screen.findByText("Hello")).toBeVisible();
      expect(load).toHaveBeenCalledTimes(3);
    },
  );

  it("replaces a dialog's loading frame without treating replacement as a user close", async () => {
    const held = heldPart();
    const closed = vi.fn();
    render(
      <LazyPart
        doing="Opening…"
        frame={(shown) => (
          <DialogOpening className="device-window" title="Listen on your device" onClose={closed}>
            {shown}
          </DialogOpening>
        )}
      >
        <held.part.Component />
      </LazyPart>,
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    await act(async () => {
      held.finish();
      await held.part.preload();
    });

    expect(screen.getByText("Hello")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(closed).not.toHaveBeenCalled();
  });

  it.each(["framed", "native"])(
    "does not renew an unfinished %s opening because an earlier background preload failed",
    async (path) => {
      servePage(undefined);
      let rejectOpening: () => void = () => undefined;
      const pending = new Promise<typeof Greeting>((_, reject) => {
        rejectOpening = () => {
          reject(new TypeError("The module is unreachable"));
        };
      });
      let reachable = false;
      let attempts = 0;
      const load = vi.fn(() => {
        attempts += 1;
        if (reachable) return Promise.resolve(Greeting);
        if (attempts === 3) return pending;
        return Promise.reject(new TypeError("The module is unreachable"));
      });
      const part = lazyPart(load);
      const failedPreload = part.preload().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 10);
      await failedPreload;
      const content =
        path === "native" ? (
          <PartFrame value={null}>
            <part.Component />
          </PartFrame>
        ) : (
          <part.Component />
        );
      const shown = <LazyPart doing="Opening…">{content}</LazyPart>;
      const { unmount } = render(shown);
      expect(load).toHaveBeenCalledTimes(3);

      forgetFailedLoads();
      await act(async () => {
        rejectOpening();
        await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 10);
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach medleyplay");
      expect(load).toHaveBeenCalledTimes(4);
      unmount();
      reachable = true;
      render(shown);

      expect(load).toHaveBeenCalledTimes(4);
      expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
      expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach medleyplay");
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("Hello")).toBeVisible();
      expect(load).toHaveBeenCalledTimes(5);
    },
  );

  it("shows its frame, busy, while its code loads, then the part", async () => {
    const part = lazyPart(() => Promise.resolve(Greeting));

    render(
      <LazyPart doing="Opening the list…">
        <part.Component />
      </LazyPart>,
    );

    expect(screen.getByText("Opening the list…")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByText("Hello")).toBeInTheDocument();
  });

  it("puts its busy line inside the frame it is given, as a dialog's", () => {
    const part = lazyPart(() => new Promise<typeof Greeting>(() => undefined));

    render(
      <LazyPart doing="Opening…" frame={(shown) => <section aria-label="Lyrics">{shown}</section>}>
        <part.Component />
      </LazyPart>,
    );

    expect(screen.getByRole("region", { name: "Lyrics" })).toHaveTextContent("Opening…");
  });

  it("says the server can't be reached, and loads afresh when asked to try again", async () => {
    servePage(undefined);
    const { part, network } = partBehindTheNetwork();
    render(
      <LazyPart doing="Opening…">
        <part.Component />
      </LazyPart>,
    );
    await failToLoad();
    expect(await screen.findByText(/Can't reach medleyplay/u)).toBeInTheDocument();

    network.reachable = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Hello")).toBeInTheDocument();
  });

  it("translates a visible connection error without retrying the load", async () => {
    servePage(undefined);
    const { part } = partBehindTheNetwork();
    render(
      <>
        <LanguageSelect />
        <LazyPart doing="Opening…">
          <part.Component />
        </LazyPart>
      </>,
    );
    await failToLoad();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Check the connection/u);

    try {
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh-Hans");

      expect(screen.getByRole("alert")).toHaveTextContent(
        "无法连接到 medleyplay。请检查网络连接后重试。",
      );
      expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "语言" }), "auto");
    }
  });

  it("offers to reload, saying the music stops, when medleyplay was updated since the page opened", async () => {
    servePage(pageNaming("/assets/index-new.js"));
    const { part } = partBehindTheNetwork();
    render(
      <LazyPart doing="Opening…">
        <part.Component />
      </LazyPart>,
    );

    await failToLoad();

    expect(await screen.findByText(/medleyplay was updated/u)).toHaveTextContent("the music stops");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("offers to try again when the server answers with the same build", async () => {
    servePage(pageNaming("/assets/index-old.js"));
    const { part } = partBehindTheNetwork();
    render(
      <LazyPart doing="Opening…">
        <part.Component />
      </LazyPart>,
    );

    await failToLoad();

    expect(await screen.findByText(/didn't load/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it.each(["cold", "preloaded"])(
    "reports a rendering error in a %s part and retries when asked",
    async (opening) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      let broken = true;
      function Recoverable() {
        if (broken) throw new Error("A bug.");
        return <Greeting />;
      }
      const part = lazyPart(() => Promise.resolve(Recoverable));
      if (opening === "preloaded") await part.preload();
      render(
        <LazyPart doing="Opening…">
          <part.Component />
        </LazyPart>,
      );
      expect(await screen.findByText("Something went wrong here.")).toBeInTheDocument();

      broken = false;
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(screen.getByText("Hello")).toBeInTheDocument();
    },
  );

  it("keeps a part that has loaded while another one loads", async () => {
    const loaded = lazyPart(() => Promise.resolve(Greeting));
    await loaded.preload();
    const loading = lazyPart(() => new Promise<typeof Greeting>(() => undefined));

    render(
      <>
        <LazyPart doing="Opening the first…">
          <loaded.Component />
        </LazyPart>
        <LazyPart doing="Opening the second…">
          <loading.Component />
        </LazyPart>
      </>,
    );

    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Opening the second…")).toBeInTheDocument();
  });
});
