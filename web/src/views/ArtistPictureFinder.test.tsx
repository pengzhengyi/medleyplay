import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtistPictures } from "../api";
import { UNKNOWN_PICTURES as UNKNOWN, beatlesPictures, serve } from "../testing/server";
import { ArtistPictureFinder } from "./ArtistPictureFinder";

const PICTURES = "GET /api/artists/b10bbbfc/pictures";
const FIND = "POST /api/artists/b10bbbfc/pictures/find";

/** Answer the reads of The Beatles' pictures with each of `answers` in turn, then the last again. */
function reading(...answers: ArtistPictures[]) {
  let read = 0;
  return () => ({ body: answers[Math.min(read++, answers.length - 1)] });
}

function finder(onUse = vi.fn(), shown?: string) {
  render(<ArtistPictureFinder artistId="b10bbbfc" shown={shown} onUse={onUse} />);
  return onUse;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding an artist's pictures on Deezer", () => {
  it("looks an artist never looked up on Deezer at once, and shows the pictures found", async () => {
    const { calls } = serve({
      [PICTURES]: reading(UNKNOWN, beatlesPictures()),
      [FIND]: { body: null },
    });

    finder();

    const grid = await screen.findByRole("region", { name: "Pictures on Deezer" });
    expect(
      await within(grid).findByRole("button", {
        name: "Use the picture of The Beatles, 4.1M fans",
      }),
    ).toBeVisible();
    expect(
      within(grid).getByRole("button", { name: "Use the picture of The Beatles Revival" }),
    ).toBeVisible();
    expect(calls.filter((call) => call === FIND)).toHaveLength(1);
  });

  it("never asks Deezer while it is off, and says who turns it on", async () => {
    const { calls } = serve({ [PICTURES]: { body: { ...UNKNOWN, may_find: false } } });

    finder();

    expect(
      await screen.findByText("Deezer is off. An admin turns it on in Settings, under Deezer."),
    ).toBeVisible();
    expect(calls).not.toContain(FIND);
    expect(screen.queryByRole("button", { name: "Look again" })).toBeNull();
  });

  it("says when Deezer has no picture of an artist looked up, without asking again", async () => {
    const { calls } = serve({
      [PICTURES]: { body: { ...UNKNOWN, found_at: "2026-11-18T00:00:00Z" } },
    });

    finder();

    expect(await screen.findByText("Deezer has no picture of this artist.")).toBeVisible();
    expect(calls).not.toContain(FIND);
  });

  it("says why Deezer refused, to the one who asked", async () => {
    serve({
      [PICTURES]: {
        body: { ...UNKNOWN, found_at: "2026-11-18T00:00:00Z", failure: "Deezer refused: 403" },
      },
    });

    finder();

    expect(await screen.findByRole("alert")).toHaveTextContent("Deezer refused: 403");
  });

  it("uses the picture chosen, marking the one shown now", async () => {
    serve({ [PICTURES]: { body: beatlesPictures() } });
    const onUse = finder(vi.fn(), "picture-tribute");

    const tribute = await screen.findByRole("button", {
      name: "Use the picture of The Beatles Revival",
    });
    expect(tribute).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      screen.getByRole("button", { name: /^Use the picture of The Beatles,/u }),
    );

    expect(onUse).toHaveBeenCalledWith("picture-beatles");
  });

  it("looks again when asked, though found before", async () => {
    const { calls } = serve({
      [PICTURES]: reading(beatlesPictures(), beatlesPictures({ finding: true }), beatlesPictures()),
      [FIND]: { body: null },
    });
    finder();

    await userEvent.click(await screen.findByRole("button", { name: "Look again" }));

    expect(await screen.findByText("Looking on Deezer…")).toBeVisible();
    expect(calls.filter((call) => call === FIND)).toHaveLength(1);
  });
});
