import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Track } from "../api";
import { fakeMedia } from "../testing/media";
import { serve, trackOf } from "../testing/server";
import { type Player, usePlayer } from "./usePlayer";

/** *Bremen*, one album file, split into songs from 0:00 to 0:30 and from 0:30 to 1:00. */
const FIRST = trackOf(154, "アイネクライネ", { duration_ms: 30_000, segment_of: 104 });
const SECOND = trackOf(155, "ゴーゴー幽霊船", { duration_ms: 30_000, segment_of: 104 });
/** A song of another file. */
const OTHER = trackOf(7, "Melt", { duration_ms: 240_000 });

/** The server's answers: each song plays its stretch of its file's audio. */
const ANSWERS = {
  "POST /api/tracks/154/playback": { body: ready(104, 0, 30_000) },
  "POST /api/tracks/155/playback": { body: ready(104, 30_000, 60_000) },
  "POST /api/tracks/7/playback": { body: ready(7, null, null) },
};

function ready(source: number, start: number | null, end: number | null) {
  return {
    state: "ready",
    source_id: source,
    audio_url: `/api/sources/${String(source)}/audio`,
    media_type: "audio/mp4",
    start_ms: start,
    end_ms: end,
  };
}

function renderPlayer(tracks: readonly Track[]) {
  const shown: { player?: Player } = {};
  function Page() {
    const [player, audio] = usePlayer(new Map(tracks.map((track) => [track.id, track])), () => {
      throw new Error("Signed out.");
    });
    shown.player = player;
    return <audio ref={audio} />;
  }
  const { container } = render(<Page />);
  const element = container.querySelector("audio");
  if (element === null) {
    throw new Error("The player rendered no audio element.");
  }
  const media = fakeMedia(element);
  const player = () => {
    if (shown.player === undefined) {
      throw new Error("The player hasn't rendered.");
    }
    return shown.player;
  };
  return { element, media, player };
}

const playing = (player: () => Player, track: Track) =>
  waitFor(() => {
    const now = player();
    expect(now.queue.entries[now.queue.position]?.trackId).toBe(track.id);
    expect(now.status.kind).toBe("playing");
  });

describe("playing songs inside one file", () => {
  it("ends a song at its end, and plays on into the next song of its file without loading it again", async () => {
    serve(ANSWERS);
    const { element, media, player } = renderPlayer([FIRST, SECOND]);
    act(() => {
      player().playList([FIRST, SECOND], 0);
    });
    await playing(player, FIRST);
    act(() => {
      media.playTo(10);
    });

    act(() => {
      media.playTo(30.05);
    });

    await playing(player, SECOND);
    expect((({ loads, pauses }) => ({ loads, pauses }))(media)).toEqual({ loads: 1, pauses: 0 });
    expect(element.currentTime).toBe(30.05);
    act(() => {
      media.playTo(32);
    });
    expect(player().position).toBe(2);
  });

  it("shows a song's position and length from its own start, and seeks within it", async () => {
    serve(ANSWERS);
    const { element, player } = renderPlayer([SECOND]);
    act(() => {
      player().playList([SECOND], 0);
    });
    await playing(player, SECOND);
    await waitFor(() => {
      expect(player().duration).toBe(30);
    });

    act(() => {
      player().seek(10);
    });
    expect(element.currentTime).toBe(40);
    act(() => {
      player().seek(99);
    });
    expect(element.currentTime).toBe(60);
  });

  it("stops a song at its end and loads the next when it is of another file", async () => {
    serve(ANSWERS);
    const { element, media, player } = renderPlayer([FIRST, OTHER]);
    act(() => {
      player().playList([FIRST, OTHER], 0);
    });
    await playing(player, FIRST);

    act(() => {
      media.playTo(30.05);
    });

    await playing(player, OTHER);
    expect(media.pauses).toBe(1);
    expect(media.loads).toBe(2);
    expect(element.src).toMatch(/\/api\/sources\/7\/audio$/);
  });
});

describe("pausing for other music", () => {
  it("pauses what plays, and stays paused when asked again", async () => {
    serve(ANSWERS);
    const { element, player } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);

    act(() => {
      player().pause();
    });
    act(() => {
      player().pause();
    });

    expect(element.paused).toBe(true);
    expect(player().status.kind).not.toBe("playing");
  });
});
