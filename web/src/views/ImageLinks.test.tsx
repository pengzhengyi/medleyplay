import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type PictureLinks, type Pictured, type SuggestedLink, api } from "../api";
import { serve } from "../testing/server";
import { ImageLinks } from "./ImageLinks";
import { LanguageSelect } from "./LanguageSelect";
import { AiSetUpContext } from "./aiSetUp";

const HELP: Pictured = { kind: "album", album: "Help!", artist: "The Beatles" };
const COVER_LINK = "https://upload.wikimedia.org/wikipedia/en/e/e7/Help.jpg";
const COVER_PAGE = "https://en.wikipedia.org/wiki/Help!";
const BAND_LINK = "https://covers.example.org/help.jpg";

/** Nothing suggested for a picture: the AI never asked. */
const UNASKED: PictureLinks = {
  links: [],
  model: "",
  host: "",
  asked_at: null,
  asking: false,
  waiting: false,
  failure: null,
  may_suggest: true,
};

/** A link a model suggested, never fetched, with `known` on top. */
function linkTo(url: string, known: Partial<SuggestedLink> = {}): SuggestedLink {
  return {
    url,
    page: null,
    why: "",
    cover: null,
    unavailable: "",
    fetching: false,
    failure: null,
    ...known,
  };
}

/** The model named *Help!*'s cover on Wikimedia, from its article, and on the band's site. */
function helpSuggested(...links: SuggestedLink[]): PictureLinks {
  return {
    ...UNASKED,
    links:
      links.length > 0
        ? links
        : [
            linkTo(COVER_LINK, { page: COVER_PAGE, why: "The album's article shows it" }),
            linkTo(BAND_LINK),
          ],
    model: "deepseek-flash",
    host: "api.deepseek.com",
    asked_at: "2026-11-17T00:00:00Z",
  };
}

const LINKS = `GET /api/image-links/album?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;

/** Answer the reads of *Help!*'s links with each of `answers` in turn, then the last again. */
function reading(...answers: PictureLinks[]) {
  let read = 0;
  return () => ({ body: answers[Math.min(read++, answers.length - 1)] });
}

function suggestions(onUse = vi.fn(), shown?: string) {
  render(<ImageLinks pictured={HELP} shown={shown} onUse={onUse} />);
  return onUse;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pictures an AI model suggests", () => {
  it("shows each picture from its own site, fetching none", async () => {
    const { calls } = serve({ [LINKS]: { body: helpSuggested() } });

    suggestions();

    const section = await screen.findByRole("region", { name: "Pictures the AI suggests" });
    const pictures = within(section).getAllByRole("presentation");
    expect(pictures.map((picture) => picture.getAttribute("src"))).toEqual([COVER_LINK, BAND_LINK]);
    expect(
      within(section).getByRole("link", { name: "Source page: en.wikipedia.org" }),
    ).toHaveAttribute("href", COVER_PAGE);
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(within(section).getByText("No source page provided.")).toBeVisible();
  });

  it("asks the AI on opening when it was never asked", async () => {
    let asked: unknown;
    const { calls } = serve({
      [LINKS]: reading(UNASKED, helpSuggested()),
      "POST /api/image-links/album/suggest": (body) => {
        asked = body;
        return { status: 202, body: null };
      },
    });

    suggestions();

    expect(await screen.findByRole("button", { name: /from covers\.example\.org/u })).toBeVisible();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
      "POST /api/image-links/album/suggest",
    ]);
    expect(asked).toEqual({ album: "Help!", artist: "The Beatles", hint: "" });
  });

  it("asks nothing on opening while the AI is being asked", async () => {
    const { calls } = serve({ [LINKS]: { body: { ...UNASKED, asking: true } } });

    suggestions();

    expect(await screen.findByText("Asking the AI for pictures…")).toBeVisible();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("asks nothing on opening without an AI provider, and says how to set one up", async () => {
    const { calls } = serve({ [LINKS]: { body: UNASKED } });

    render(
      <AiSetUpContext value={{ missing: true, admin: true }}>
        <ImageLinks pictured={HELP} shown={null} onUse={vi.fn()} />
      </AiSetUpContext>,
    );

    expect(await screen.findByText(/No AI provider is enabled\./u)).toBeVisible();
    expect(screen.getByRole("link", { name: "Set up AI" })).toBeVisible();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("asks again with a note of what the listener wants", async () => {
    let asked: unknown;
    serve({
      [LINKS]: { body: helpSuggested() },
      "POST /api/image-links/album/suggest": (body) => {
        asked = body;
        return { status: 202, body: null };
      },
    });
    suggestions();

    await userEvent.click(await screen.findByRole("button", { name: "Ask again" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Anything the AI should know?" }),
      "the 1997 first pressing{Enter}",
    );

    await waitFor(() => {
      expect(asked).toEqual({
        album: "Help!",
        artist: "The Beatles",
        hint: "the 1997 first pressing",
      });
    });
  });

  it("puts the note away on Escape, asking nothing", async () => {
    const { calls } = serve({ [LINKS]: { body: helpSuggested() } });
    suggestions();
    await userEvent.click(await screen.findByRole("button", { name: "Ask again" }));

    await userEvent.type(
      screen.getByRole("textbox", { name: "Anything the AI should know?" }),
      "{Escape}",
    );

    expect(screen.queryByRole("textbox", { name: "Anything the AI should know?" })).toBeNull();
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("says when the AI knows no picture", async () => {
    serve({ [LINKS]: { body: { ...UNASKED, asked_at: "2026-11-17T00:00:00Z" } } });

    suggestions();

    expect(await screen.findByText("The AI knows no picture of this album.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ask again" })).toBeVisible();
  });

  it("marks a picture that won't show as unavailable, and won't approve it", async () => {
    const { calls } = serve({ [LINKS]: { body: helpSuggested() } });
    suggestions();
    const section = await screen.findByRole("region", { name: "Pictures the AI suggests" });

    fireEvent.error(within(section).getAllByRole("presentation")[0] ?? section);
    const approve = screen.getByRole("button", {
      name: "Download and use the picture from upload.wikimedia.org",
    });
    await userEvent.click(approve);

    expect(within(section).getByText("Unavailable")).toBeVisible();
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(calls).not.toContain("POST /api/image-links/album/approve");
  });

  it("downloads a picture approved, and uses it once downloaded", async () => {
    const fetched = helpSuggested(linkTo(COVER_LINK, { cover: "cover-help" }), linkTo(BAND_LINK));
    let approved: unknown;
    serve({
      [LINKS]: reading(helpSuggested(), fetched),
      "POST /api/image-links/album/approve": (body) => {
        approved = body;
        return { status: 202, body: { cover: null } };
      },
    });

    const onUse = suggestions();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Download and use the picture from upload.wikimedia.org",
      }),
    );

    await waitFor(() => {
      expect(onUse).toHaveBeenCalledWith("cover-help");
    });
    expect(approved).toEqual({ album: "Help!", artist: "The Beatles", url: COVER_LINK });
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("applies only the approved picture even if another download also finishes", async () => {
    const fetched = helpSuggested(
      linkTo(BAND_LINK, { cover: "other-cover" }),
      linkTo(COVER_LINK, { cover: "cover-help" }),
    );
    const { calls } = serve({
      [LINKS]: reading(helpSuggested(), fetched),
      "POST /api/image-links/album/approve": { status: 202, body: { cover: null } },
    });

    const onUse = suggestions();
    const first = await screen.findByRole("button", { name: /from upload\.wikimedia\.org/u });
    const second = screen.getByRole("button", { name: /from covers\.example\.org/u });

    fireEvent.click(first);
    fireEvent.click(second);

    expect(second).toBeDisabled();
    await waitFor(() => {
      expect(onUse).toHaveBeenCalledExactlyOnceWith("cover-help");
    });
    expect(calls.filter((call) => call.endsWith("/approve"))).toHaveLength(1);
  });

  it("releases the picture controls when an accepted download stops without an image", async () => {
    serve({
      [LINKS]: { body: helpSuggested() },
      "POST /api/image-links/album/approve": { status: 202, body: { cover: null } },
    });
    const onUse = suggestions();
    const button = await screen.findByRole("button", { name: /from upload\.wikimedia\.org/u });

    await userEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The download did not finish. Try again.",
    );
    expect(button).toBeEnabled();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("does not mistake a previous failure read before approval for the retry's result", async () => {
    const old = helpSuggested(linkTo(COVER_LINK, { unavailable: "HTTP 404" }));
    const { calls } = serve({ [LINKS]: { body: old } });
    let finish: (result: { cover: string }) => void = () => undefined;
    const approval = vi.spyOn(api, "approveImageLink").mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onUse = suggestions();
    const button = await screen.findByRole("button", { name: /from upload\.wikimedia\.org/u });

    vi.useFakeTimers();
    try {
      fireEvent.click(button);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(calls.filter((call) => call === LINKS)).toHaveLength(2);
      expect(button).toBeDisabled();

      await act(async () => {
        finish({ cover: "fetched-on-retry" });
        await Promise.resolve();
      });

      expect(onUse).toHaveBeenCalledExactlyOnceWith("fetched-on-retry");
    } finally {
      approval.mockRestore();
      vi.useRealTimers();
    }
  });

  it("explains how a member can restore Ask again even when past suggestions are still shown", async () => {
    serve({ [LINKS]: { body: { ...helpSuggested(), may_suggest: false } } });
    render(
      <AiSetUpContext
        value={{ missing: true, admin: false, recheck: () => Promise.resolve(false) }}
      >
        <ImageLinks pictured={HELP} shown={null} onUse={vi.fn()} />
      </AiSetUpContext>,
    );

    const ask = await screen.findByRole("button", { name: "Ask again" });

    expect(ask).toBeDisabled();
    expect(ask).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText("No AI provider is enabled. Ask an admin to add or enable one."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /from upload\.wikimedia\.org/u })).toBeEnabled();
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });
    try {
      await userEvent.selectOptions(language, "zh-Hans");
      expect(screen.getByRole("button", { name: "重新检查" })).toBeEnabled();
    } finally {
      await userEvent.selectOptions(language, "auto");
    }
  });

  it("does not submit a suggestion request when the configured service cannot offer one", async () => {
    const { calls } = serve({ [LINKS]: { body: { ...UNASKED, may_suggest: false } } });
    suggestions();

    const ask = await screen.findByRole("button", { name: "Ask AI" });
    await userEvent.click(ask);

    expect(ask).toBeDisabled();
    expect(screen.getByText("AI picture suggestions are unavailable.")).toBeVisible();
    expect(calls).toEqual([LINKS]);
  });

  it("translates the visible approval and retry actions without changing their image hosts", async () => {
    serve({
      [LINKS]: {
        body: helpSuggested(linkTo(COVER_LINK), linkTo(BAND_LINK, { unavailable: "HTTP 404" })),
      },
    });
    suggestions();
    const user = userEvent.setup();
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(
        await screen.findByRole("button", { name: /upload\.wikimedia\.org/u }),
      ).toHaveTextContent("确认下载");
      expect(screen.getByRole("button", { name: /covers\.example\.org/u })).toHaveTextContent(
        "重试",
      );
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("uses a picture downloaded before at once", async () => {
    serve({
      [LINKS]: { body: helpSuggested() },
      "POST /api/image-links/album/approve": { status: 202, body: { cover: "cover-help" } },
    });
    const onUse = suggestions();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Download and use the picture from upload.wikimedia.org",
      }),
    );

    await waitFor(() => {
      expect(onUse).toHaveBeenCalledWith("cover-help");
    });
  });

  it("shows a picture being downloaded as downloading", async () => {
    serve({ [LINKS]: { body: helpSuggested(linkTo(COVER_LINK, { fetching: true })) } });

    suggestions();

    expect(await screen.findByRole("status", { name: "Downloading…" })).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Download and use the picture from upload.wikimedia.org",
      }),
    ).toBeDisabled();
  });

  it("lets a picture found unavailable be tried again, saying why", async () => {
    const why = "upload.wikimedia.org has no image there (404).";
    serve({ [LINKS]: { body: helpSuggested(linkTo(COVER_LINK, { unavailable: why })) } });

    suggestions();

    const again = await screen.findByRole("button", {
      name: "Download and use the picture from upload.wikimedia.org",
    });
    expect(again).toHaveTextContent("Try again");
    expect(screen.getByTitle(why)).toContainElement(screen.getByText("Unavailable"));
  });

  it("reports unread suggestions without assuming there are no pictures", async () => {
    serve({});

    render(<ImageLinks pictured={HELP} shown={null} onUse={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read picture suggestions",
    );
    expect(screen.queryByText(/The AI knows no picture/u)).not.toBeInTheDocument();
  });
});
