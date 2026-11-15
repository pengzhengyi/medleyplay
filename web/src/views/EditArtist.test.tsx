import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtistSuggestionState, KnownArtist } from "../api";
import { artistSuggestionOf, knownArtistOf, serve } from "../testing/server";
import { EditArtist } from "./EditArtist";
import { MAX_COVER_BYTES } from "./EditDetails";

/** The Beatles, with Wikidata's photo, going by 披头士 and 甲壳虫乐队 too. */
const BEATLES: KnownArtist = knownArtistOf("b10bbbfc", "The Beatles", {
  aliases: [
    { name: "披头士", locale: "zh", primary: true },
    { name: "甲壳虫乐队", locale: "zh", primary: false },
  ],
  photo: "wikidata-photo",
  photo_page: "https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
});
const DETAILS = "PUT /api/artists/b10bbbfc/details";
const PHOTO = "/api/artists/b10bbbfc/photo";
const SUGGESTION = "/api/artists/b10bbbfc/suggestion";
/** No AI model asked about the artist yet. */
const UNASKED: ArtistSuggestionState = { asking: false, suggestion: null, failure: null };

/** The editor for `artist`, written as 披头士 by most of its songs. */
function editing(artist: KnownArtist = BEATLES) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(<EditArtist artist={artist} written="披头士" onChanged={onChanged} onClose={onClose} />);
  return { onChanged, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("editing an artist", () => {
  it("offers every name the artist goes by to be shown as, the songs' own first", () => {
    editing();

    const shownAs = screen.getByRole("combobox", { name: /Shown as/u });
    expect(shownAs).toHaveAttribute("placeholder", "披头士");
    const offered = [...document.querySelectorAll("datalist option")].map((option) =>
      option.getAttribute("value"),
    );
    expect(offered).toEqual(["披头士", "The Beatles", "甲壳虫乐队"]);
  });

  it("saves the name shown and the note, and reads the artists again", async () => {
    const sent: unknown[] = [];
    serve({
      [DETAILS]: (body) => {
        sent.push(body);
        return { status: 204 };
      },
    });
    const { onChanged } = editing();

    await userEvent.type(screen.getByRole("combobox", { name: /Shown as/u }), "甲壳虫乐队");
    await userEvent.type(screen.getByRole("textbox", { name: "About" }), "Four lads.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(sent).toEqual([{ shown_as: "甲壳虫乐队", about: "Four lads." }]);
  });

  it("forgets a name emptied, so the songs' own name shows again", async () => {
    const sent: unknown[] = [];
    serve({
      [DETAILS]: (body) => {
        sent.push(body);
        return { status: 204 };
      },
    });
    editing({ ...BEATLES, shown_as: "甲壳虫乐队" });

    await userEvent.clear(screen.getByRole("combobox", { name: /Shown as/u }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(sent).toEqual([{ shown_as: null, about: null }]);
    });
  });

  it("saves nothing until something changes", () => {
    editing();

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says why a save failed, beside the form", async () => {
    serve({ [DETAILS]: { status: 422, body: { detail: "The note is at most 1000 characters." } } });
    const { onChanged } = editing();

    await userEvent.type(screen.getByRole("textbox", { name: "About" }), "Four lads.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The note is at most 1000 characters.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("sets a photo of the household's at once", async () => {
    const server = serve({
      [`GET ${SUGGESTION}`]: { body: UNASKED },
      [`PUT ${PHOTO}`]: { status: 204 },
    });
    const { onChanged } = editing();

    await userEvent.upload(
      screen.getByLabelText("Replace the photo"),
      new File(["jpeg"], "beatles.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(server.calls).toEqual([`GET ${SUGGESTION}`, `PUT ${PHOTO}`]);
  });

  it("sends no photo past 10 MiB, and says so beside the photo", async () => {
    const server = serve({ [`GET ${SUGGESTION}`]: { body: UNASKED } });
    const photo = new File(["jpeg"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(photo, "size", { value: MAX_COVER_BYTES + 1 });
    editing();

    await userEvent.upload(screen.getByLabelText("Replace the photo"), photo);

    expect(screen.getByRole("alert")).toHaveTextContent("A photo is at most 10 MiB.");
    expect(server.calls).toEqual([`GET ${SUGGESTION}`]);
  });

  it("says why a photo was refused, beside the photo", async () => {
    serve({
      [`PUT ${PHOTO}`]: { status: 422, body: { detail: "That is no JPEG, PNG, or WebP image." } },
    });
    const { onChanged } = editing();

    await userEvent.upload(
      screen.getByLabelText("Replace the photo"),
      new File(["gif"], "beatles.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is no JPEG, PNG, or WebP image.",
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says a photo from Wikidata is, and offers no way to remove it", () => {
    editing();

    expect(screen.getByText("From Wikidata")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove your photo" })).toBeNull();
  });

  it("offers to cancel once something changed, and to close before", async () => {
    editing();
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();

    await userEvent.type(screen.getByRole("textbox", { name: "About" }), "Four lads.");

    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("removes the household's own photo, so Wikidata's shows again", async () => {
    const server = serve({
      [`GET ${SUGGESTION}`]: { body: UNASKED },
      [`DELETE ${PHOTO}`]: { status: 204 },
    });
    const { onChanged } = editing({ ...BEATLES, photo: "own-photo", own_photo: true });
    await userEvent.click(screen.getByRole("button", { name: "Remove your photo" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(server.calls).toEqual([`GET ${SUGGESTION}`, `DELETE ${PHOTO}`]);
  });
});

describe("asking the AI about an artist", () => {
  it("offers what the AI last suggested beside each field, to use", async () => {
    serve({ [`GET ${SUGGESTION}`]: { body: { ...UNASKED, suggestion: artistSuggestionOf() } } });
    editing();

    const name = await screen.findByRole("group", {
      name: "deepseek-flash's suggestion for Shown as",
    });
    expect(name).toHaveTextContent("deepseek-flash suggests “甲壳虫乐队”");
    await userEvent.click(
      within(name).getByRole("button", { name: "Use “甲壳虫乐队”, suggested by deepseek-flash" }),
    );
    const about = screen.getByRole("group", { name: "deepseek-flash's suggestion for About" });
    await userEvent.click(within(about).getByRole("button", { name: /^Use/u }));

    expect(screen.getByRole("combobox", { name: /Shown as/u })).toHaveValue("甲壳虫乐队");
    expect(screen.getByRole("textbox", { name: "About" })).toHaveValue(
      "An English rock band from Liverpool.",
    );
    expect(screen.queryByRole("group", { name: /suggestion for/u })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("asks the AI with one spinner, and shows its answer once it has answered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state = UNASKED;
    serve({
      [`GET ${SUGGESTION}`]: () => ({ body: state }),
      [`POST ${SUGGESTION}`]: () => {
        state = { ...UNASKED, asking: true };
        return { status: 202, body: null };
      },
    });
    editing();

    await userEvent.click(await screen.findByRole("button", { name: "Ask AI" }));

    expect(await screen.findByRole("button", { name: "Asking the AI…" })).toBeDisabled();
    state = { ...UNASKED, suggestion: artistSuggestionOf() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(
      await screen.findByRole("group", { name: "deepseek-flash's suggestion for Shown as" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeEnabled();
  });

  it("says why the last asking failed, beside Ask AI", async () => {
    serve({ [`GET ${SUGGESTION}`]: { body: { ...UNASKED, failure: "The key was refused." } } });
    editing();

    expect(await screen.findByRole("alert")).toHaveTextContent("The key was refused.");
  });

  it("says why the AI could not be asked, beside Ask AI", async () => {
    serve({
      [`GET ${SUGGESTION}`]: { body: UNASKED },
      [`POST ${SUGGESTION}`]: {
        status: 409,
        body: { detail: "Set up an AI provider in Settings to ask it." },
      },
    });
    editing();

    await userEvent.click(await screen.findByRole("button", { name: "Ask AI" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Set up an AI provider in Settings to ask it.",
    );
  });
});
