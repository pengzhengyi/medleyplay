import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_AFTER_MS, lazyPart } from "../lazyPart";
import { LanguageSelect } from "./LanguageSelect";
import { LazyPart } from "./LazyPart";

/** What a part shows once loaded. */
function Greeting() {
  return <p>Hello</p>;
}

/** A part whose code loads only once `reachable` is set, as after the network returns. */
function partBehindTheNetwork() {
  const network = { reachable: false };
  const part = lazyPart(() =>
    network.reachable
      ? Promise.resolve(Greeting)
      : Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  );
  return { part, network };
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

  it("says something went wrong when the part loaded but failed to show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error("A bug.");
    }
    const part = lazyPart(() => Promise.resolve(Broken));

    render(
      <LazyPart doing="Opening…">
        <part.Component />
      </LazyPart>,
    );

    expect(await screen.findByText("Something went wrong here.")).toBeInTheDocument();
  });

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
