import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { hrefOf } from "../routes";
import { trackOf } from "../testing/server";
import { SongCredits } from "./SongCredits";

/** 千里之外, sung by 周杰伦 and 费玉清, from 依然范特西. */
const DUET = trackOf(5, "千里之外", {
  artist: "周杰伦/费玉清",
  artists: ["周杰伦", "费玉清"],
  album: "依然范特西",
});

describe("a song's credits", () => {
  it("links each artist and the album to its page", () => {
    render(<SongCredits track={DUET} />);

    expect(screen.getByRole("link", { name: "费玉清" })).toHaveAttribute(
      "href",
      expect.stringContaining("#/artist"),
    );
    expect(screen.getByRole("link", { name: "依然范特西" })).toHaveAttribute(
      "href",
      hrefOf({ view: "album", artist: "周杰伦/费玉清", name: "依然范特西" }),
    );
  });

  it("keeps the artists and the album in two pieces, each shortened on its own", () => {
    const { container } = render(<SongCredits track={DUET} />);

    const pieces = [...container.querySelectorAll(".credit")];
    expect(pieces.map((piece) => piece.textContent)).toEqual(["周杰伦, 费玉清", "依然范特西"]);
    expect(container.querySelector(".song-credits")?.textContent).toBe(
      "周杰伦, 费玉清 — 依然范特西",
    );
  });

  it("shows each piece's whole name on hover, however short it is drawn", () => {
    const { container } = render(<SongCredits track={DUET} />);

    const pieces = [...container.querySelectorAll(".credit")];
    expect(pieces.map((piece) => piece.getAttribute("title"))).toEqual([
      "周杰伦, 费玉清",
      "依然范特西",
    ]);
  });

  it("names only the artists when the album is the song itself", () => {
    const { container } = render(
      <SongCredits track={trackOf(6, "Bremen", { artist: "ryo", album: "Bremen" })} />,
    );

    expect(container.querySelector(".song-credits")?.textContent).toBe("ryo");
  });
});
