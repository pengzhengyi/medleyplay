import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AlbumSteps } from "../player/albumNow";
import { playerOf } from "../testing/player";
import { trackOf } from "../testing/server";
import { Transport } from "./Transport";

/** The second song of an album playing between two others, with an album after it. */
const MID_ALBUM: AlbumSteps = {
  previousSong: { key: "e", seconds: 0 },
  nextSong: { key: "g", seconds: 0 },
  previousAlbum: { key: "e", seconds: 0 },
  nextAlbum: { key: "h", seconds: 0 },
};

const buttons = () => screen.getAllByRole("button").map((button) => button.ariaLabel);

describe("the playing controls", () => {
  it("step by song while a song of its own plays", () => {
    render(<Transport player={playerOf()} track={trackOf(1, "Melt")} />);

    expect(buttons()).toEqual(["Shuffle", "Previous", "Pause", "Next", "Repeat: off"]);
  });

  it("step by album, and by song inside it, while an album plays", () => {
    render(<Transport player={playerOf()} track={trackOf(1, "Melt")} steps={MID_ALBUM} />);

    expect(buttons()).toEqual([
      "Shuffle",
      "Previous album",
      "Previous song",
      "Pause",
      "Next song",
      "Next album",
      "Repeat: off",
    ]);
  });

  it("play the album or song each step goes to", async () => {
    const player = playerOf();
    render(<Transport player={player} track={trackOf(1, "Melt")} steps={MID_ALBUM} />);

    await userEvent.click(screen.getByRole("button", { name: "Next album" }));
    await userEvent.click(screen.getByRole("button", { name: "Next song" }));

    expect(player.playAt).toHaveBeenNthCalledWith(1, "h", 0);
    expect(player.playAt).toHaveBeenNthCalledWith(2, "g", 0);
  });

  it("seek within a split file playing whole, from where its song starts", async () => {
    const player = playerOf();
    const whole: AlbumSteps = { ...MID_ALBUM, nextSong: { key: "w", seconds: 540 } };
    render(<Transport player={player} track={trackOf(9, "生如夏花")} steps={whole} />);

    await userEvent.click(screen.getByRole("button", { name: "Next song" }));

    expect(player.playAt).toHaveBeenCalledWith("w", 540);
  });

  it("can't step past the last song or album", () => {
    const last: AlbumSteps = { ...MID_ALBUM, nextSong: undefined, nextAlbum: undefined };

    render(<Transport player={playerOf()} track={trackOf(1, "Melt")} steps={last} />);

    expect(screen.getByRole("button", { name: "Next song" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next album" })).toBeDisabled();
  });

  it("step only by album through a whole album with no songs known", () => {
    const whole: AlbumSteps = { ...MID_ALBUM, previousSong: undefined, nextSong: undefined };

    render(<Transport player={playerOf()} track={trackOf(5, "Bremen")} steps={whole} />);

    expect(screen.queryByRole("button", { name: /song$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next album" })).toBeEnabled();
  });
});
