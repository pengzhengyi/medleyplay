import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ArtistName, ArtistNames, KnownArtist, Track } from "../api";
import { artistNameOf, serve, trackOf } from "../testing/server";
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

/** DeepSeek's model, asked at its own host. */
const BY_DEEPSEEK = {
  model: "deepseek-flash",
  host: "api.deepseek.com",
  at: "2026-11-15T12:00:00Z",
};

/** Show the section listing `names`. */
function openList(names: ArtistNames, tracks: readonly Track[] = []) {
  const onChanged = vi.fn();
  render(<LinkArtists names={names} tracks={tracks} onChanged={onChanged} />);
  return { list: screen.getByRole("region", { name: /Link artist names/ }), onChanged };
}

const rowOf = (list: HTMLElement, name: string) =>
  within(list)
    .getAllByRole("listitem")
    .find((row) => within(row).queryByText(name, { selector: "strong" }) !== null) ?? document.body;

describe("linking names to artists", () => {
  it("counts the names that may be linked and are not, and leaves out names of no one", () => {
    const { list } = openList(
      namesOf(LOOKED_UP, artistNameOf("The Beatles", BEATLES.id), {
        ...artistNameOf("群星"),
        look_up: "never",
      }),
    );

    expect(
      within(list).getByRole("heading", { name: /^Link artist names\s*1$/ }),
    ).toBeInTheDocument();
    expect(rowOf(list, "群星")).toBe(document.body);
  });

  it("links a name to the artist suggested for it", async () => {
    const server = serve({ "PUT /api/artist-names/link": { status: 204 } });
    const { list, onChanged } = openList(namesOf(LOOKED_UP));
    const row = rowOf(list, "披头士");

    const suggested = within(row).getByRole("radio", { name: /The Beatles/ });
    await userEvent.click(within(row).getByRole("button", { name: "Link 披头士" }));

    expect(suggested).toBeChecked();
    expect(server.calls).toContain("PUT /api/artist-names/link");
    expect(onChanged).toHaveBeenCalled();
  });

  it("chooses the suggestion once a name looked up while the list is open comes back", () => {
    serve({ "PUT /api/artist-names/link": { status: 204 } });
    const onChanged = vi.fn();
    const { rerender } = render(
      <LinkArtists
        names={namesOf(artistNameOf("披头士"), artistNameOf("Blue Room"))}
        onChanged={onChanged}
      />,
    );

    rerender(
      <LinkArtists names={namesOf(LOOKED_UP, artistNameOf("Blue Room"))} onChanged={onChanged} />,
    );

    const row = rowOf(screen.getByRole("region"), "披头士");
    expect(within(row).getByRole("radio", { name: /The Beatles/ })).toBeChecked();
    expect(within(row).getByRole("button", { name: "Link 披头士" })).toBeEnabled();
  });

  it("offers a name an artist already linked goes by that artist, still to look up", () => {
    const { list } = openList(
      namesOf({
        ...artistNameOf("甲壳虫乐队"),
        candidates: [{ artist_id: BEATLES.id, score: 100 }],
        suggested: BEATLES.id,
      }),
    );
    const row = rowOf(list, "甲壳虫乐队");

    expect(within(row).getByRole("radio", { name: /The Beatles/ })).toBeChecked();
    expect(within(row).getByRole("button", { name: "Look up 甲壳虫乐队" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Link 甲壳虫乐队" })).toBeEnabled();
  });

  it("marks the artist going by a name exactly as the one recommended", () => {
    const { list } = openList(namesOf(LOOKED_UP));
    const row = rowOf(list, "披头士");

    const beatles = within(row)
      .getByRole("radio", { name: /The Beatles/ })
      .closest("label");
    expect(beatles).toHaveTextContent("Goes by this name");
    expect(
      within(row)
        .getByRole("radio", { name: /tribute/ })
        .closest("label"),
    ).not.toHaveTextContent("Goes by this name");
  });

  it("links every name with a recommended artist at once, leaving the rest", async () => {
    const sent: unknown[] = [];
    serve({
      "PUT /api/artist-names/link": (body) => {
        sent.push(body);
        return { status: 204 };
      },
    });
    const unsure: ArtistName = { ...LOOKED_UP, ...artistNameOf("Beatles?"), suggested: null };
    const { list, onChanged } = openList(
      namesOf(LOOKED_UP, {
        ...unsure,
        looked_at: LOOKED_UP.looked_at,
        candidates: LOOKED_UP.candidates,
      }),
    );

    await userEvent.click(within(list).getByRole("button", { name: "Link 1 recommended" }));

    expect(sent).toEqual([{ name: "披头士", artist_id: BEATLES.id }]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("moves on to the next name's Link once one is linked, so Enter links it", async () => {
    serve({ "PUT /api/artist-names/link": { status: 204 } });
    const next: ArtistName = {
      ...LOOKED_UP,
      ...artistNameOf("甲壳虫"),
      looked_at: LOOKED_UP.looked_at,
      candidates: LOOKED_UP.candidates,
      suggested: BEATLES.id,
    };
    const { list } = openList(namesOf(LOOKED_UP, next));

    await userEvent.click(
      within(rowOf(list, "披头士")).getByRole("button", { name: "Link 披头士" }),
    );

    expect(
      within(rowOf(list, "甲壳虫")).getByRole("button", { name: "Link 甲壳虫" }),
    ).toHaveFocus();
  });

  it("marks the artist an AI model recommends over the one going by the name", () => {
    const { list } = openList(
      namesOf({
        ...LOOKED_UP,
        recommendation: { ...BY_DEEPSEEK, artist_id: TRIBUTE.id, why: "Its songs are covers" },
      }),
    );
    const row = rowOf(list, "披头士");

    const tribute = within(row).getByRole("radio", { name: /tribute/ });
    expect(tribute).toBeChecked();
    expect(tribute.closest("label")).toHaveTextContent("deepseek-flash suggests");
    expect(
      within(row)
        .getByRole("radio", { name: /The Beatles/ })
        .closest("label"),
    ).not.toHaveTextContent("Goes by this name");
  });

  it("marks None of these when an AI model recommends none, and leaves the name out of Link all", () => {
    const { list } = openList(
      namesOf({
        ...LOOKED_UP,
        recommendation: { ...BY_DEEPSEEK, artist_id: null, why: "A different band" },
      }),
    );
    const row = rowOf(list, "披头士");

    expect(row).toHaveTextContent("deepseek-flash suggests none of these: A different band");
    expect(within(row).getByRole("button", { name: "None of these for 披头士" })).toHaveClass(
      "recommended",
    );
    expect(within(list).queryByRole("button", { name: /^Link \d+ recommended$/ })).toBeNull();
  });

  it("asks an AI model for recommendations, saying while it is asked", async () => {
    const server = serve({ "POST /api/artist-names/recommend": { body: { asked: 1 } } });
    const { list, onChanged } = openList(namesOf(LOOKED_UP));

    await userEvent.click(within(list).getByRole("button", { name: "Ask AI" }));

    expect(server.calls).toContain("POST /api/artist-names/recommend");
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers no Ask AI when every name it could ask about needs tidying first", () => {
    const { list } = openList(namesOf({ ...LOOKED_UP, look_up: "tidy_first" }));

    expect(within(list).queryByRole("button", { name: "Ask AI" })).toBeNull();
  });

  it("says while an AI model is being asked", () => {
    render(
      <LinkArtists names={{ ...namesOf(LOOKED_UP), recommending: true }} onChanged={vi.fn()} />,
    );

    const asking = screen.getByRole("button", { name: "Asking the AI…" });
    expect(asking).toBeDisabled();
    // Its own spinner alone: busy, Pico would draw a second.
    expect(asking).not.toHaveAttribute("aria-busy");
    expect(asking.querySelectorAll(".spin")).toHaveLength(1);
  });

  it("links a name to none of the artists found", async () => {
    let sent: unknown;
    serve({
      "PUT /api/artist-names/link": (body) => {
        sent = body;
        return { status: 204 };
      },
    });
    const { list } = openList(namesOf(LOOKED_UP));

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
    const { list } = openList(
      namesOf(LOOKED_UP, artistNameOf("Blue Room"), artistNameOf("朴树"), {
        ...artistNameOf("周杰伦2000年发行"),
        look_up: "tidy_first",
      }),
    );

    await userEvent.click(within(list).getByRole("button", { name: "Look up 2 names" }));

    expect(sent).toEqual({ names: ["Blue Room", "朴树"] });
  });

  it("says a name is being looked up, or needs tidying first", () => {
    const { list } = openList(
      namesOf(
        LOOKED_UP,
        { ...artistNameOf("Blue Room"), finding: true },
        {
          ...artistNameOf("周杰伦2000年发行"),
          look_up: "tidy_first",
        },
      ),
    );

    expect(rowOf(list, "Blue Room")).toHaveTextContent("Looking it up on MusicBrainz…");
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
    const { list } = openList(
      namesOf(LOOKED_UP, { ...artistNameOf("Beatles", BEATLES.id), tracks: 1 }),
    );
    const row = rowOf(list, "Beatles");

    await userEvent.click(within(row).getByRole("button", { name: "Unlink Beatles" }));

    expect(row).toHaveTextContent("The Beatles");
    expect(sent).toEqual({ name: "Beatles" });
  });

  it("says while Wikidata is asked a linked artist's other names", () => {
    const { list } = openList(
      namesOf(LOOKED_UP, { ...artistNameOf("Beatles", BEATLES.id), finding: true }),
    );

    expect(rowOf(list, "Beatles")).toHaveTextContent("Finding its other names on Wikidata…");
  });

  it("says why a link failed, beside the name", async () => {
    serve({
      "PUT /api/artist-names/link": {
        status: 404,
        body: { detail: "MusicBrainz hasn't named that artist for any name here." },
      },
    });
    const { list } = openList(namesOf(LOOKED_UP));
    const row = rowOf(list, "披头士");

    await userEvent.click(within(row).getByRole("button", { name: "Link 披头士" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent("hasn't named");
  });

  it("shows a name's songs, with their albums, on its song count", () => {
    const { list } = openList(namesOf(artistNameOf("Guest")), [
      trackOf(1, "Encore", { artist: "Guest", album: "Live at Home" }),
      trackOf(2, "Elsewhere", { artist: "Someone", album: "Other" }),
    ]);

    expect(within(list).getByRole("button", { name: "1 song" })).toHaveAccessibleDescription(
      "Encore — Live at Home",
    );
  });

  it("shows eight of a name's songs, and how many more", () => {
    const songs = Array.from({ length: 10 }, (_, n) =>
      trackOf(n + 1, `Song ${String(n + 1)}`, { artist: "Guest", album: "" }),
    );
    const { list } = openList(namesOf({ ...artistNameOf("Guest"), tracks: 10 }), songs);

    const count = within(list).getByRole("button", { name: "10 songs" });
    expect(count).toHaveAccessibleDescription(/^Song 1 Song 2 .* Song 8 and 2 more$/u);
  });
});
