import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { KnownArtist } from "../api";
import { trackOf } from "../testing/server";
import { ArtistAbout } from "./ArtistAbout";

/** The Beatles as MusicBrainz knows them, going by 披头士 and 甲壳虫乐队 too. */
const BEATLES: KnownArtist = {
  id: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
  name: "The Beatles",
  sort_name: "Beatles, The",
  disambiguation: "Liverpool rock band",
  country: "GB",
  aliases: [
    { name: "披头士", locale: "zh", primary: true },
    { name: "甲壳虫乐队", locale: "zh", primary: false },
  ],
};

/** A song of `album` with the cover `cover`. */
const songOn = (id: number, album: string, cover: string | null) =>
  trackOf(id, `Song ${String(id)}`, { artist: "The Beatles", album, cover });

describe("about an artist", () => {
  it("shows the covers of up to four of its albums", () => {
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[
          songOn(1, "Abbey Road", "abbey.jpg"),
          songOn(2, "Help!", "help.jpg"),
          songOn(3, "Let It Be", null),
          songOn(4, "Revolver", "revolver.jpg"),
          songOn(5, "Rubber Soul", "rubber.jpg"),
          songOn(6, "Yellow Submarine", "yellow.jpg"),
        ]}
        artist={BEATLES}
        toLink={false}
      />,
    );

    const art = screen.getByRole("img", { name: "Album covers of The Beatles" });
    expect(art.querySelectorAll("img")).toHaveLength(4);
  });

  it("shows the artist's initial when no album has a cover", () => {
    render(
      <ArtistAbout
        name="朴树"
        songs={[songOn(1, "生如夏花", null)]}
        artist={undefined}
        toLink={false}
      />,
    );

    expect(screen.getByRole("img", { name: "Album covers of 朴树" })).toHaveTextContent("朴");
  });

  it("links a linked artist to MusicBrainz, Wikidata, and a Rate Your Music search", () => {
    render(<ArtistAbout name="披头士" songs={[]} artist={BEATLES} toLink={false} />);

    const links = within(screen.getByRole("list", { name: "The artist elsewhere" }));
    expect(links.getByRole("link", { name: "MusicBrainz" })).toHaveAttribute(
      "href",
      "https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
    );
    expect(links.getByRole("link", { name: "Wikidata" })).toHaveAttribute(
      "href",
      "https://www.wikidata.org/w/index.php?search=haswbstatement%3AP434%3Db10bbbfc-cf9e-42e0-be17-e2c3e1d2600d",
    );
    expect(links.getByRole("link", { name: "Rate Your Music" })).toHaveAttribute(
      "href",
      "https://rateyourmusic.com/search?searchterm=The%20Beatles&searchtype=a",
    );
    for (const link of links.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("says what tells the artist apart, and the other names it goes by", () => {
    render(<ArtistAbout name="披头士" songs={[]} artist={BEATLES} toLink={false} />);

    expect(screen.getByText("The Beatles (Liverpool rock band, GB)")).toBeInTheDocument();
    expect(screen.getByText("Goes by 甲壳虫乐队")).toBeInTheDocument();
  });

  it("shows six other names, and the rest when asked", async () => {
    const many: KnownArtist = {
      ...BEATLES,
      aliases: ["A", "B", "C", "D", "E", "F", "G", "H"].map((name) => ({
        name,
        locale: null,
        primary: false,
      })),
    };
    render(<ArtistAbout name="The Beatles" songs={[]} artist={many} toLink={false} />);

    expect(screen.getByText(/^Goes by A, B, C, D, E, F/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "and 2 more" }));

    expect(screen.getByText("Goes by A, B, C, D, E, F, G, H")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "and 2 more" })).toBeNull();
  });

  it("searches Rate Your Music by the name alone, and offers to link a name not linked", () => {
    render(<ArtistAbout name="朴树" songs={[]} artist={undefined} toLink />);

    const links = within(screen.getByRole("list", { name: "The artist elsewhere" }));
    expect(links.getAllByRole("link").map((link) => link.textContent)).toEqual(["Rate Your Music"]);
    expect(screen.getByRole("link", { name: "Link it to an artist" })).toHaveAttribute(
      "href",
      "#/clean-up",
    );
  });
});
