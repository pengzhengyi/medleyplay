import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PictureLinks, Pictured, SuggestedLink } from "../api";
import { serve } from "../testing/server";
import { ImageLinks } from "./ImageLinks";
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
    expect(within(section).getByRole("link", { name: "upload.wikimedia.org" })).toHaveAttribute(
      "href",
      COVER_PAGE,
    );
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
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

    expect(await screen.findByText(/No AI provider is set up\./u)).toBeVisible();
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

  it("shows nothing when the links can't be read", async () => {
    serve({});

    const { container } = render(<ImageLinks pictured={HELP} shown={null} onUse={vi.fn()} />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
