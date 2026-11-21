import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AlbumCovers } from "../api";
import { UNKNOWN_COVERS, helpFound, serve, trackOf } from "../testing/server";
import { AlbumAbout } from "./AlbumAbout";

/** The songs of 范特西 by 周杰伦, with its cover. */
const FANTASY = [
  trackOf(1, "爱在西元前", { album: "范特西", artist: "周杰伦", cover: "fantasy.jpg" }),
  trackOf(2, "简单爱", { album: "范特西", artist: "周杰伦", cover: "fantasy.jpg" }),
];

/** The songs of *Help!* by The Beatles, with no cover. */
const HELP = [
  trackOf(3, "Help!", { album: "Help!", artist: "The Beatles", cover: null }),
  trackOf(4, "Yesterday", { album: "Help!", artist: "The Beatles", cover: null }),
];

const FANTASY_COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "范特西", artist: "周杰伦" }).toString()}`;
const HELP_COVERS = `GET /api/album-covers?${new URLSearchParams({ album: "Help!", artist: "The Beatles" }).toString()}`;

/** Answer the reads of *Help!*'s covers with each of `answers` in turn, then the last again. */
function reading(...answers: AlbumCovers[]) {
  let read = 0;
  return () => ({ body: answers[Math.min(read++, answers.length - 1)] });
}

/** Show *Help!*'s page, with no cover; return what uses a cover. */
function help(onUse = vi.fn(() => Promise.resolve())) {
  render(
    <AlbumAbout
      album="Help!"
      artist="The Beatles"
      songs={HELP}
      cover={null}
      onUse={onUse}
      onUpload={vi.fn()}
    />,
  );
  return onUse;
}

const IMAGE = new File([new Uint8Array([0xff, 0xd8, 0xff])], "fantasy.jpg", {
  type: "image/jpeg",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an album's cover on its page", () => {
  it("opens the picture editor from the cover itself", async () => {
    serve({});
    render(
      <AlbumAbout
        album="范特西"
        artist="周杰伦"
        songs={FANTASY}
        cover="fantasy.jpg"
        onUse={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Replace the cover…" }));

    expect(await screen.findByRole("dialog", { name: "Replace the cover" })).toBeVisible();
  });

  it("sets an image uploaded on every song of the album", async () => {
    serve({ [FANTASY_COVERS]: { body: { ...UNKNOWN_COVERS, due: false } } });
    const onUpload = vi.fn(() => Promise.resolve("new-cover"));
    render(
      <AlbumAbout
        album="范特西"
        artist="周杰伦"
        songs={FANTASY}
        cover={null}
        onUse={vi.fn()}
        onUpload={onUpload}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add a cover…" }));
    const editor = await screen.findByRole("dialog", { name: "Add a cover" });
    await userEvent.upload(within(editor).getByLabelText("Choose a cover file"), IMAGE);
    await userEvent.click(within(editor).getByRole("button", { name: "Use this cover" }));

    expect(onUpload).toHaveBeenCalledWith(FANTASY, IMAGE);
  });

  it("only shows the cover when it can't be changed here", () => {
    render(<AlbumAbout album="范特西" artist="周杰伦" songs={FANTASY} cover="fantasy.jpg" />);

    expect(screen.getByRole("region", { name: "About the album" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Replace the cover…" })).toBeNull();
  });
});

describe("a cover suggested for an album without one", () => {
  it("looks on MusicBrainz once for an album never looked up, saying so", async () => {
    const { calls } = serve({
      [HELP_COVERS]: reading(UNKNOWN_COVERS, { ...UNKNOWN_COVERS, due: false, finding: true }),
      "POST /api/album-covers/find": { body: null },
    });

    help();

    expect(await screen.findByRole("status")).toHaveTextContent("Looking on MusicBrainz…");
    expect(calls.filter((call) => call === "POST /api/album-covers/find")).toHaveLength(1);
  });

  it("looks no more for an album looked up, nor while MusicBrainz is off", async () => {
    const { calls } = serve({
      [HELP_COVERS]: { body: { ...UNKNOWN_COVERS, may_find: false } },
    });

    help();

    expect(await screen.findByRole("button", { name: "Add a cover…" })).toBeVisible();
    expect(calls).not.toContain("POST /api/album-covers/find");
  });

  it("stands in for the empty cover, saying it is a suggestion and why", async () => {
    serve({ [HELP_COVERS]: { body: helpFound({ suggested: "cover-1965" }) } });

    help();

    expect(
      await screen.findByRole("img", {
        name: "Suggested cover of Help!: MusicBrainz's Help!, 1965, GB, 12\" Vinyl",
      }),
    ).toBeVisible();
    expect(screen.getByText("Suggested")).toBeVisible();
  });

  it("is used on every song in one click", async () => {
    serve({ [HELP_COVERS]: { body: helpFound({ suggested: "cover-1965" }) } });
    const onUse = help();

    await userEvent.click(
      await screen.findByRole("button", { name: "Use the suggested cover of Help!" }),
    );

    expect(onUse).toHaveBeenCalledWith(HELP, "cover-1965");
  });

  it("is dismissed in one click, and the empty cover stands again", async () => {
    const sent: unknown[] = [];
    serve({
      [HELP_COVERS]: reading(helpFound({ suggested: "cover-1965" }), helpFound()),
      "POST /api/album-covers/dismiss": (body) => {
        sent.push(body);
        return { body: null };
      },
    });
    help();

    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss the suggested cover of Help!" }),
    );

    expect(await screen.findByRole("button", { name: "Add a cover…" })).toBeVisible();
    expect(sent).toEqual([{ album: "Help!", artist: "The Beatles", cover: "cover-1965" }]);
  });

  it("opens the cover editor on MusicBrainz to choose another", async () => {
    serve({ [HELP_COVERS]: { body: helpFound({ suggested: "cover-1965" }) } });
    help();

    await userEvent.click(
      await screen.findByRole("button", { name: "Choose another cover of Help!…" }),
    );

    const editor = await screen.findByRole("dialog", { name: "Add a cover" });
    expect(within(editor).getByRole("tab", { name: /MusicBrainz/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
