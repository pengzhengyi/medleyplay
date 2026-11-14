import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ArtistName, ArtistNames, KnownArtist } from "../api";
import { artistNameOf, serve } from "../testing/server";
import { LinkArtists } from "./LinkArtists";

const BEATLES: KnownArtist = {
  id: "b10bbbfc",
  name: "The Beatles",
  sort_name: "Beatles, The",
  disambiguation: "UK rock band",
  country: "GB",
  aliases: [{ name: "披头士", locale: "zh", primary: true }],
};
const TRIBUTE: KnownArtist = {
  id: "6a3b5c1e",
  name: "披头士乐队纪念乐团",
  sort_name: "",
  disambiguation: "Beatles tribute band",
  country: "CN",
  aliases: [],
};

/** 披头士, looked up: The Beatles, suggested, and a tribute band. */
const LOOKED_UP: ArtistName = {
  ...artistNameOf("披头士"),
  tracks: 2,
  looked_at: "2026-11-15T12:00:00Z",
  candidates: [
    { artist_id: BEATLES.id, score: 100 },
    { artist_id: TRIBUTE.id, score: 61 },
  ],
  suggested: BEATLES.id,
};

const namesOf = (...names: ArtistName[]): ArtistNames => ({ names, artists: [BEATLES, TRIBUTE] });

async function openList(names: ArtistNames) {
  const onChanged = vi.fn();
  render(<LinkArtists names={names} onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: /^Link \d+ artist names?$/ }));
  return { list: screen.getByRole("dialog", { name: "Link names to artists" }), onChanged };
}

const rowOf = (list: HTMLElement, name: string) =>
  within(list)
    .getAllByRole("listitem")
    .find((row) => within(row).queryByText(name, { selector: "strong" }) !== null) ?? document.body;

describe("linking names to artists", () => {
  it("offers nothing when every name is linked or names no one", () => {
    render(
      <LinkArtists
        names={namesOf(artistNameOf("The Beatles", BEATLES.id), {
          ...artistNameOf("群星"),
          look_up: "never",
        })}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("links a name to the artist suggested for it", async () => {
    const server = serve({ "PUT /api/artist-names/link": { status: 204 } });
    const { list, onChanged } = await openList(namesOf(LOOKED_UP));
    const row = rowOf(list, "披头士");

    const suggested = within(row).getByRole("radio", { name: /The Beatles/ });
    await userEvent.click(within(row).getByRole("button", { name: "Link 披头士" }));

    expect(suggested).toBeChecked();
    expect(server.calls).toContain("PUT /api/artist-names/link");
    expect(onChanged).toHaveBeenCalled();
  });

  it("links a name to none of the artists found", async () => {
    let sent: unknown;
    serve({
      "PUT /api/artist-names/link": (body) => {
        sent = body;
        return { status: 204 };
      },
    });
    const { list } = await openList(namesOf(LOOKED_UP));

    await userEvent.click(
      within(rowOf(list, "披头士")).getByRole("button", { name: "None of these for 披头士" }),
    );

    expect(sent).toEqual({ name: "披头士", artist_id: null });
  });

  it("looks every name not looked up yet up at once", async () => {
    let sent: unknown;
    serve({
      "POST /api/artist-names/look-up": (body) => {
        sent = body;
        return { body: { asked: 2 } };
      },
    });
    const { list } = await openList(
      namesOf(LOOKED_UP, artistNameOf("Kraftwerk"), artistNameOf("朴树"), {
        ...artistNameOf("周杰伦2000年发行"),
        look_up: "tidy_first",
      }),
    );

    await userEvent.click(within(list).getByRole("button", { name: "Look up 2 names" }));

    expect(sent).toEqual({ names: ["Kraftwerk", "朴树"] });
  });

  it("says a name is being looked up, or needs tidying first", async () => {
    const { list } = await openList(
      namesOf(
        LOOKED_UP,
        { ...artistNameOf("Kraftwerk"), finding: true },
        {
          ...artistNameOf("周杰伦2000年发行"),
          look_up: "tidy_first",
        },
      ),
    );

    expect(rowOf(list, "Kraftwerk")).toHaveTextContent("Looking it up on MusicBrainz…");
    expect(rowOf(list, "周杰伦2000年发行")).toHaveTextContent("Tidy the name first");
  });

  it("shows what a name is linked to, and unlinks it", async () => {
    let sent: unknown;
    serve({
      "POST /api/artist-names/unlink": (body) => {
        sent = body;
        return { status: 204 };
      },
    });
    const { list } = await openList(
      namesOf(LOOKED_UP, { ...artistNameOf("Beatles", BEATLES.id), tracks: 1 }),
    );
    const row = rowOf(list, "Beatles");

    await userEvent.click(within(row).getByRole("button", { name: "Unlink Beatles" }));

    expect(row).toHaveTextContent("The Beatles");
    expect(sent).toEqual({ name: "Beatles" });
  });

  it("says why a link failed, beside the name", async () => {
    serve({
      "PUT /api/artist-names/link": {
        status: 404,
        body: { detail: "MusicBrainz hasn't named that artist for any name here." },
      },
    });
    const { list } = await openList(namesOf(LOOKED_UP));
    const row = rowOf(list, "披头士");

    await userEvent.click(within(row).getByRole("button", { name: "Link 披头士" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent("hasn't named");
  });
});
