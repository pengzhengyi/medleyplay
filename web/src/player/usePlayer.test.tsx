import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "../api";
import { fakeMedia, fakeSystemMedia } from "../testing/media";
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
  const { container, unmount } = render(<Page />);
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
  return { element, media, player, unmount };
}

const playing = (player: () => Player, track: Track) =>
  waitFor(() => {
    const now = player();
    expect(now.queue.entries[now.queue.position]?.trackId).toBe(track.id);
    expect(now.status.kind).toBe("playing");
  });

describe("playing songs inside one file", () => {
  it("keeps queue commands stable while elapsed time changes", async () => {
    serve(ANSWERS);
    const { media, player } = renderPlayer([FIRST, SECOND, OTHER]);
    act(() => {
      player().playList([FIRST, SECOND, OTHER], 0);
    });
    await playing(player, FIRST);
    const before = player();

    act(() => {
      media.playTo(8);
    });

    expect(player().position).toBe(8);
    expect(player().queue).toBe(before.queue);
    expect(player().playAt).toBe(before.playAt);
    expect(player().move).toBe(before.move);
    expect(player().remove).toBe(before.remove);
  });

  it("uses the current song and stretch when seeking after a queue jump", async () => {
    serve(ANSWERS);
    const { element, player } = renderPlayer([FIRST, SECOND]);
    act(() => {
      player().playList([FIRST, SECOND], 0);
    });
    await playing(player, FIRST);
    const seek = player().seek;
    const second = player().queue.entries[1]?.key ?? "";
    act(() => {
      player().playAt(second, 5);
    });
    await playing(player, SECOND);

    act(() => {
      player().playAt(second, 9);
    });
    expect(element.currentTime).toBe(39);
    act(() => {
      seek(12);
    });

    expect(element.currentTime).toBe(42);
    expect(element.getAttribute("src")).toBe("/api/sources/104/audio");
  });

  it("moves and removes from the current queue through retained commands", async () => {
    serve(ANSWERS);
    const { player } = renderPlayer([FIRST, SECOND, OTHER]);
    act(() => {
      player().playList([FIRST, SECOND], 0);
    });
    await playing(player, FIRST);
    const { move, remove } = player();
    act(() => {
      player().add(OTHER);
    });
    const added = player().queue.entries[2]?.key ?? "";

    act(() => {
      move(added, 0);
    });
    expect(player().queue.entries.map((entry) => entry.trackId)).toEqual([154, 7, 155]);
    act(() => {
      remove(added);
    });

    expect(player().queue.entries.map((entry) => entry.trackId)).toEqual([154, 155]);
  });

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

  it("plays another song of the file from a second into it, playing on in place", async () => {
    serve(ANSWERS);
    const { element, media, player } = renderPlayer([FIRST, SECOND]);
    act(() => {
      player().playList([FIRST, SECOND], 0, () => "file:104");
    });
    await playing(player, FIRST);
    act(() => {
      media.playTo(10);
    });
    const second = player().queue.entries[1]?.key ?? "";

    act(() => {
      player().playAt(second, 5);
    });

    await playing(player, SECOND);
    expect(element.currentTime).toBe(35);
    expect(media.loads).toBe(1);
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

describe("following the system's media keys and audio devices", () => {
  let system: ReturnType<typeof fakeSystemMedia>;
  beforeEach(() => {
    system = fakeSystemMedia();
  });
  afterEach(() => {
    // The player lets go of the system's media keys as it goes, so it goes first.
    cleanup();
    system.restore();
  });

  it("stays paused when the system asks to pause twice, as taking out both earbuds does", async () => {
    serve(ANSWERS);
    const { element, player } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);

    act(() => {
      system.press("pause");
    });
    act(() => {
      system.press("pause");
    });

    expect(element.paused).toBe(true);
    expect(player().status.kind).toBe("paused");
  });

  it("plays on when the system asks to play while playing", async () => {
    serve(ANSWERS);
    const { media, player } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);

    act(() => {
      system.press("play");
    });

    expect(player().status.kind).toBe("playing");
    expect(media.pauses).toBe(0);
  });

  it("plays again when the system asks to play while paused", async () => {
    serve(ANSWERS);
    const { player } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);
    act(() => {
      system.press("pause");
    });

    act(() => {
      system.press("play");
    });

    await playing(player, OTHER);
  });

  it("pauses when an audio device comes or goes, so it doesn't play on aloud through another", async () => {
    serve(ANSWERS);
    const { element, player } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);

    act(() => {
      system.changeDevices();
    });

    expect(element.paused).toBe(true);
    expect(player().status.kind).toBe("paused");
  });

  it("no longer pauses for a change of devices once the player is gone", async () => {
    serve(ANSWERS);
    const { media, player, unmount } = renderPlayer([OTHER]);
    act(() => {
      player().playList([OTHER], 0);
    });
    await playing(player, OTHER);
    unmount();
    const pauses = media.pauses;

    system.changeDevices();

    expect(media.pauses).toBe(pauses);
  });

  it("plays on a page told of no devices, as one over plain HTTP is", async () => {
    system.restore();
    system = fakeSystemMedia({ secure: false });
    serve(ANSWERS);
    const { player } = renderPlayer([OTHER]);

    act(() => {
      player().playList([OTHER], 0);
    });

    await playing(player, OTHER);
  });
});

describe("recording plays", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Play on from `from` to `to` seconds into the file, a second at a time, as a browser does. */
  function listen(media: ReturnType<typeof fakeMedia>, from: number, to: number) {
    act(() => {
      for (let second = from; second <= to; second++) {
        media.playTo(second);
      }
    });
  }

  /**
   * Serve the playback answers, and keep what each play request sent, in order: a
   * `record` of a new play, or a time `listened`.
   */
  function servingPlays() {
    const sent: [string, unknown][] = [];
    serve(ANSWERS);
    const answer = globalThis.fetch;
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
      if (!path.startsWith("/api/plays/")) {
        return answer(path, init);
      }
      const listened = path.endsWith("/listened");
      sent.push([listened ? "listened" : "record", JSON.parse(init?.body as string)]);
      return Promise.resolve(
        listened ? new Response(null, { status: 204 }) : new Response(JSON.stringify(OTHER)),
      );
    });
    return sent;
  }

  /** What was sent of the first play once the requests settle. */
  const settled = (sent: [string, unknown][], count: number) =>
    waitFor(() => {
      expect(sent).toHaveLength(count);
    });

  it("records a play once half its song has played, with the time listened so far", async () => {
    const sent = servingPlays();
    const { media, player } = renderPlayer([OTHER, FIRST]);
    act(() => {
      player().playList([OTHER, FIRST], 0);
    });
    await playing(player, OTHER);

    listen(media, 0, 120);

    await settled(sent, 1);
    expect(sent[0]).toEqual([
      "record",
      expect.objectContaining({ track_id: 7, listened_ms: 120_000 }) as unknown,
    ]);
  });

  it("sends the time again each further minute, and what is left when the next song starts", async () => {
    const sent = servingPlays();
    const { media, player } = renderPlayer([OTHER, FIRST]);
    act(() => {
      player().playList([OTHER, FIRST], 0);
    });
    await playing(player, OTHER);
    listen(media, 0, 180);
    await settled(sent, 2);

    listen(media, 181, 200);
    act(() => {
      player().next();
    });

    await settled(sent, 3);
    expect(sent.slice(1)).toEqual([
      ["listened", { listened_ms: 180_000 }],
      ["listened", { listened_ms: 200_000 }],
    ]);
  });

  it("adds nothing for a seek, so skipping to the end isn't listening", async () => {
    const sent = servingPlays();
    const { media, player } = renderPlayer([OTHER, FIRST]);
    act(() => {
      player().playList([OTHER, FIRST], 0);
    });
    await playing(player, OTHER);
    listen(media, 0, 120);
    await settled(sent, 1);

    listen(media, 230, 235);
    act(() => {
      player().next();
    });

    await settled(sent, 2);
    expect(sent[1]).toEqual(["listened", { listened_ms: 125_000 }]);
  });
});
