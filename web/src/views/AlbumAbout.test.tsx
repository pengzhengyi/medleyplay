import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serve, trackOf } from "../testing/server";
import { AlbumAbout } from "./AlbumAbout";

/** The songs of 范特西 by 周杰伦, with its cover. */
const FANTASY = [
  trackOf(1, "爱在西元前", { album: "范特西", artist: "周杰伦", cover: "fantasy.jpg" }),
  trackOf(2, "简单爱", { album: "范特西", artist: "周杰伦", cover: "fantasy.jpg" }),
];

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
    serve({});
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
