import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serve } from "../testing/server";
import { AlbumRatingNote } from "./AlbumRatingNote";

afterEach(() => {
  vi.unstubAllGlobals();
});

const FILM_OF_LIFE = `GET /api/album-rating?${new URLSearchParams({
  artist: "Tony Allen",
  album: "Film of Life",
}).toString()}`;

describe("your imported rating of an album", () => {
  it("shows your stars and your review, as the review was written", async () => {
    serve({ [FILM_OF_LIFE]: { body: { stars: 4, note: "Warm & loose.\nSide B <b>drags</b>." } } });

    render(<AlbumRatingNote artist="Tony Allen" album="Film of Life" />);

    const note = await screen.findByRole("note", { name: "Your rating of this album" });
    expect(note).toHaveTextContent("You rated it 4 stars on Rate Your Music");
    expect(screen.getByText(/Side B <b>drags<\/b>\./u)).toHaveClass("album-review");
  });

  it("says nothing for an album you didn't rate", async () => {
    const { calls } = serve({ [FILM_OF_LIFE]: { body: null } });

    render(<AlbumRatingNote artist="Tony Allen" album="Film of Life" />);

    await vi.waitFor(() => {
      expect(calls).toContain(FILM_OF_LIFE);
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("shows a review of an album you didn't rate", async () => {
    serve({ [FILM_OF_LIFE]: { body: { stars: null, note: "Never finished it." } } });

    render(<AlbumRatingNote artist="Tony Allen" album="Film of Life" />);

    const note = await screen.findByRole("note", { name: "Your rating of this album" });
    expect(note).toHaveTextContent("Your review on Rate Your Music");
    expect(note).toHaveTextContent("Never finished it.");
  });
});
