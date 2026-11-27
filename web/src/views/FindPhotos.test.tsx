import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissingPhoto } from "../api";
import { toDoOf } from "../library/cleanUp";
import { serve } from "../testing/server";
import { CleanUpView } from "./CleanUpView";

const FIND = "POST /api/artist-photos/find";

/** An artist with no photo, by `name`, with `change` on top: not looked up yet. */
function missing(artistId: string, name: string, change: Partial<MissingPhoto> = {}) {
  return {
    artist_id: artistId,
    name,
    songs: 3,
    suggested: null,
    picked: false,
    found: false,
    finding: false,
    ...change,
  } satisfies MissingPhoto;
}

/** The Beatles, with a photo suggested by name; 周杰伦, by an AI's pick. */
const SUGGESTED = [
  missing("beatles", "The Beatles", { suggested: "picture-beatles", found: true }),
  missing("chou", "周杰伦", { suggested: "picture-chou", picked: true, found: true, songs: 1 }),
];

function cleanUp(artists: readonly MissingPhoto[]) {
  const reload = vi.fn();
  const view = (answered: number) => (
    <CleanUpView
      admin
      tidy={{ names: [], reload: vi.fn() }}
      artistNames={undefined}
      missingPhotos={{ artists, reload, answered }}
    />
  );
  const { rerender } = render(view(0));
  return {
    reload,
    /** Show the same artists again, as an answer saying nothing changed does. */
    answeredAgain: (answered: number) => {
      rerender(view(answered));
    },
  };
}

const section = () => within(screen.getByRole("region", { name: /^Find artist photos/u }));

/** The suggested photo's tile of the artist `name`. */
const tileOf = (name: string) =>
  section()
    .getAllByRole("listitem")
    .find((tile) => within(tile).queryByRole("link", { name }) !== null) ?? document.body;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("finding artist photos in Clean up", () => {
  it("counts each photo suggested", () => {
    expect(
      toDoOf([], undefined, undefined, undefined, undefined, [...SUGGESTED, missing("x", "X")]),
    ).toBe(2);
  });

  it("shows each photo suggested, tagged, with its artist's songs", () => {
    serve({ [FIND]: { body: { asked: 0 } } });
    cleanUp(SUGGESTED);

    const [beatles, chou] = within(
      section().getByRole("list", { name: "Photos suggested" }),
    ).getAllByRole("listitem");

    expect(within(beatles ?? document.body).getByText("Suggested")).toBeVisible();
    expect(within(beatles ?? document.body).getByText("3 songs")).toBeVisible();
    expect(within(chou ?? document.body).getByText("AI pick")).toBeVisible();
    expect(within(chou ?? document.body).getByRole("link", { name: "周杰伦" })).toHaveAttribute(
      "href",
      "#/artist?name=%E5%91%A8%E6%9D%B0%E4%BC%A6",
    );
  });

  it("uses a photo suggested in one click", async () => {
    const sent: unknown[] = [];
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": (body) => {
        sent.push(body);
        return { body: null };
      },
    });
    const { reload } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    );

    expect(sent).toEqual([{ cover: "picture-beatles" }]);
    expect(reload).toHaveBeenCalled();
  });

  it("shows a photo being used as saving at once, taking no more input", async () => {
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": { body: null, after: new Promise(() => undefined) },
    });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    );

    const beatles = within(tileOf("The Beatles"));
    expect(beatles.getByRole("group", { name: "Suggested photo of The Beatles" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(beatles.getByText("Saving…")).toBeVisible();
    for (const control of beatles.getAllByRole("button")) {
      expect(control).toBeDisabled();
    }
    expect(
      section().getByRole("button", { name: "Use the suggested photo of 周杰伦" }),
    ).toBeEnabled();
  });

  it("keeps a photo used saving until the artists are read again without it", async () => {
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": { body: null },
    });
    const { reload } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    );

    expect(reload).toHaveBeenCalled();
    expect(within(tileOf("The Beatles")).getByText("Saving…")).toBeVisible();
    expect(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    ).toBeDisabled();
  });

  it("lets a photo be used again when saving it fails", async () => {
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": { status: 500, body: { detail: "Disk full" } },
    });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    );

    expect(await section().findByRole("alert")).toHaveTextContent("Disk full");
    expect(within(tileOf("The Beatles")).queryByText("Saving…")).not.toBeInTheDocument();
    expect(
      section().getByRole("button", { name: "Use the suggested photo of The Beatles" }),
    ).toBeEnabled();
  });

  it("shows every photo as saving while all are used", async () => {
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": { body: null, after: new Promise(() => undefined) },
    });
    cleanUp(SUGGESTED);

    await userEvent.click(section().getByRole("button", { name: "Use all 2" }));

    expect(section().getAllByText("Saving…")).toHaveLength(2);
    expect(section().getByRole("button", { name: "Use all 2" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("dismisses a photo suggested in one click", async () => {
    const sent: unknown[] = [];
    serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/pictures/dismiss": (body) => {
        sent.push(body);
        return { status: 204 };
      },
    });
    const { reload } = cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Dismiss the suggested photo of The Beatles" }),
    );

    expect(sent).toEqual([{ cover: "picture-beatles" }]);
    expect(reload).toHaveBeenCalled();
  });

  it("opens the photo editor to choose another", async () => {
    serve({ [FIND]: { body: { asked: 0 } } });
    cleanUp(SUGGESTED);

    await userEvent.click(
      section().getByRole("button", { name: "Choose another photo of 周杰伦…" }),
    );

    expect(await screen.findByRole("dialog", { name: "Add a photo" })).toBeVisible();
  });

  it("uses every photo suggested at once", async () => {
    const { calls } = serve({
      [FIND]: { body: { asked: 0 } },
      "POST /api/artists/beatles/photo/cover": { body: null },
      "POST /api/artists/chou/photo/cover": { body: null },
    });
    cleanUp(SUGGESTED);

    await userEvent.click(section().getByRole("button", { name: "Use all 2" }));

    expect(calls).toEqual(
      expect.arrayContaining([
        "POST /api/artists/beatles/photo/cover",
        "POST /api/artists/chou/photo/cover",
      ]),
    );
  });

  it("counts the artists Deezer has nothing for and those not looked up, saying where that is set", () => {
    serve({ [FIND]: { body: { asked: 0 } } });
    cleanUp([missing("a", "A", { found: true }), missing("b", "B"), missing("c", "C")]);

    expect(
      section().getByText(
        /^1 artist has no current photo suggestion; 2 artists aren't looked up yet\./u,
      ),
    ).toBeVisible();
    expect(section().getByRole("link", { name: "Settings → Deezer" })).toHaveAttribute(
      "href",
      "#/settings?section=deezer",
    );
  });

  it("asks once, on opening, for every artist with no photo to be looked up", async () => {
    const sent: unknown[] = [];
    serve({
      [FIND]: (body) => {
        sent.push(body);
        return { body: { asked: 1 } };
      },
    });
    const { reload } = cleanUp([missing("b", "B")]);

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });

    expect(sent).toEqual([{ track_ids: null }]);
  });

  it("reads again a few seconds after each answer while Deezer is asked, the same one too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({ [FIND]: { body: { asked: 0 } } });
    const { reload, answeredAgain } = cleanUp([missing("chou", "周杰伦", { finding: true })]);

    await act(() => vi.advanceTimersByTimeAsync(3000));
    answeredAgain(1);
    await act(() => vi.advanceTimersByTimeAsync(3000));

    expect(reload).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
