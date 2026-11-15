import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArtist } from "../api";
import { knownArtistOf, serve } from "../testing/server";
import { EditArtist } from "./EditArtist";

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

/** The editor for `artist`, written as 披头士 by most of its songs. */
function editing(artist: KnownArtist = BEATLES) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(<EditArtist artist={artist} written="披头士" onChanged={onChanged} onClose={onClose} />);
  return { onChanged, onClose };
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    const server = serve({ [`PUT ${PHOTO}`]: { status: 204 } });
    const { onChanged } = editing();

    await userEvent.upload(
      screen.getByLabelText("Replace the photo"),
      new File(["jpeg"], "beatles.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(server.calls).toEqual([`PUT ${PHOTO}`]);
  });

  it("says where the photo is from, and removes only the household's own", async () => {
    editing();
    expect(screen.getByText("From Wikidata")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove your photo" })).toBeNull();

    const server = serve({ [`DELETE ${PHOTO}`]: { status: 204 } });
    const { onChanged } = editing({ ...BEATLES, photo: "own-photo", own_photo: true });
    await userEvent.click(screen.getByRole("button", { name: "Remove your photo" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(server.calls).toEqual([`DELETE ${PHOTO}`]);
  });
});
