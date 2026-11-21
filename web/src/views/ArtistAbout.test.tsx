import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KnownArtist } from "../api";
import { beatlesPictures, knownArtistOf, serve, trackOf } from "../testing/server";
import { ArtistAbout } from "./ArtistAbout";

/** The Beatles as MusicBrainz knows them, going by 披头士 and 甲壳虫乐队 too. */
const BEATLES: KnownArtist = knownArtistOf("b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", "The Beatles", {
  sort_name: "Beatles, The",
  disambiguation: "Liverpool rock band",
  country: "GB",
  aliases: [
    { name: "披头士", locale: "zh", primary: true },
    { name: "甲壳虫乐队", locale: "zh", primary: false },
  ],
});

/** The Beatles once Wikidata has answered: their item, and a photo from Commons. */
const BEATLES_ON_WIKIDATA: KnownArtist = {
  ...BEATLES,
  page: "https://www.wikidata.org/wiki/Q1299",
  photo: "beatles-photo",
  photo_page: "https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
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

  it("shows the artist's photo in place of its album covers, crediting where it comes from", () => {
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[songOn(1, "Abbey Road", "abbey.jpg")]}
        artist={BEATLES_ON_WIKIDATA}
        toLink={false}
      />,
    );

    const photo = screen.getByRole("img", { name: "Photo of The Beatles" });
    expect(photo.querySelector("img")).toHaveAttribute(
      "src",
      "/api/covers/beatles-photo?size=medium&recipe=1",
    );
    expect(screen.queryByRole("img", { name: "Album covers of The Beatles" })).toBeNull();
    const credit = screen.getByRole("link", { name: "Photo: Wikimedia Commons" });
    expect(credit).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
    );
    expect(credit).toHaveAttribute("target", "_blank");
  });

  it("links straight to the artist's Wikidata item once Wikidata has answered", () => {
    render(<ArtistAbout name="披头士" songs={[]} artist={BEATLES_ON_WIKIDATA} toLink={false} />);

    const links = within(screen.getByRole("list", { name: "The artist elsewhere" }));
    expect(links.getByRole("link", { name: "Wikidata" })).toHaveAttribute(
      "href",
      "https://www.wikidata.org/wiki/Q1299",
    );
  });

  it("links to no page that is not on the web over HTTPS", () => {
    const odd: KnownArtist = {
      ...BEATLES_ON_WIKIDATA,
      page: "javascript:alert(1)",
      photo_page: "http://commons.wikimedia.org/wiki/File:The_Beatles.jpg",
    };
    render(<ArtistAbout name="The Beatles" songs={[]} artist={odd} toLink={false} />);

    const links = within(screen.getByRole("list", { name: "The artist elsewhere" }));
    expect(links.getByRole("link", { name: "Wikidata" }).getAttribute("href")).toMatch(
      /^https:\/\/www\.wikidata\.org\/w\/index\.php\?search=/u,
    );
    expect(screen.queryByRole("link", { name: "Photo: Wikimedia Commons" })).toBeNull();
  });

  it("shows the household's note about the artist", () => {
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[]}
        artist={{ ...BEATLES, about: "Four lads from Liverpool." }}
        toLink={false}
      />,
    );

    expect(screen.getByText("Four lads from Liverpool.")).toBeInTheDocument();
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

describe("replacing a linked artist's photo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the photo editor from the photo itself", async () => {
    serve({});
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[songOn(1, "Help!", "help.jpg")]}
        artist={BEATLES_ON_WIKIDATA}
        toLink={false}
        onPhotoUsed={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Replace the photo…" }));

    expect(await screen.findByRole("dialog", { name: "Replace the photo" })).toBeVisible();
  });

  it("offers none while the artist can't be changed here", () => {
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[songOn(1, "Help!", "help.jpg")]}
        artist={BEATLES_ON_WIKIDATA}
        toLink={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Replace the photo…" })).toBeNull();
  });
});

describe("a photo suggested for an artist with none", () => {
  const PICTURES = `GET /api/artists/${BEATLES.id}/pictures`;
  const USE = `POST /api/artists/${BEATLES.id}/photo/cover`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function about(onPhotoUsed = vi.fn()) {
    render(
      <ArtistAbout
        name="The Beatles"
        songs={[songOn(1, "Help!", "help.jpg")]}
        artist={BEATLES}
        toLink={false}
        onPhotoUsed={onPhotoUsed}
      />,
    );
    return onPhotoUsed;
  }

  it("stands in for the covers, saying it is a suggestion and why", async () => {
    serve({ [PICTURES]: { body: beatlesPictures({ suggested: "picture-beatles" }) } });
    about();

    const photo = await screen.findByRole("img", { name: /^Suggested photo of The Beatles/u });

    expect(photo).toHaveAccessibleName(
      "Suggested photo of The Beatles: Deezer's The Beatles, 4.1M fans, going by this artist's name",
    );
    expect(screen.getByText("Suggested")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Album covers of The Beatles" })).toBeNull();
  });

  it("says when the AI picked it, and why", async () => {
    const pick = {
      cover: "picture-tribute",
      why: "The tribute act asked for",
      hint: "",
      model: "deepseek-flash",
      host: "api.deepseek.com",
      at: "2026-11-19T00:00:00Z",
    };
    serve({
      [PICTURES]: { body: beatlesPictures({ suggested: "picture-tribute", pick }) },
    });
    about();

    expect(
      await screen.findByRole("img", {
        name: "Suggested photo of The Beatles: deepseek-flash picked this: The tribute act asked for",
      }),
    ).toBeVisible();
    expect(screen.getByText("AI pick")).toBeVisible();
  });

  it("is used in one click", async () => {
    const sent: unknown[] = [];
    serve({
      [PICTURES]: { body: beatlesPictures({ suggested: "picture-beatles" }) },
      [USE]: (body) => {
        sent.push(body);
        return { body: null };
      },
    });
    const onPhotoUsed = about();

    await userEvent.click(
      await screen.findByRole("button", { name: "Use the suggested photo of The Beatles" }),
    );

    expect(sent).toEqual([{ cover: "picture-beatles" }]);
    expect(onPhotoUsed).toHaveBeenCalled();
  });

  it("is dismissed in one click, and the covers stand in again", async () => {
    let dismissed: unknown;
    serve({
      [PICTURES]: () => ({
        body: beatlesPictures(dismissed === undefined ? { suggested: "picture-beatles" } : {}),
      }),
      [`POST /api/artists/${BEATLES.id}/pictures/dismiss`]: (body) => {
        dismissed = body;
        return { body: null };
      },
    });
    about();

    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss the suggested photo of The Beatles" }),
    );

    expect(dismissed).toEqual({ cover: "picture-beatles" });
    expect(await screen.findByRole("img", { name: "Album covers of The Beatles" })).toBeVisible();
  });

  it("opens the photo editor to choose another", async () => {
    serve({ [PICTURES]: { body: beatlesPictures({ suggested: "picture-beatles" }) } });
    about();

    await userEvent.click(
      await screen.findByRole("button", { name: "Choose another photo of The Beatles…" }),
    );

    expect(await screen.findByRole("dialog", { name: "Add a photo" })).toBeVisible();
  });

  it("leaves the covers while nothing is suggested", async () => {
    const { calls } = serve({ [PICTURES]: { body: beatlesPictures() } });
    about();

    await vi.waitFor(() => {
      expect(calls).toContain(PICTURES);
    });

    expect(screen.getByRole("img", { name: "Album covers of The Beatles" })).toBeVisible();
  });
});
