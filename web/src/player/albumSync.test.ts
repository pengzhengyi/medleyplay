import { describe, expect, it } from "vitest";

import type { Track } from "../api";
import { trackOf } from "../testing/server";
import { updatePlayingAlbum } from "./albumSync";
import type { Entry, Queue } from "./queue";

const FILE = trackOf(10, "Suite", { kind: "album", split: true, duration_ms: 60_000 });
const FIRST = trackOf(11, "Opening", {
  segment_of: 10,
  segment_start_ms: 0,
  track_number: 1,
  duration_ms: 30_000,
});
const LAST = trackOf(12, "Closing", {
  segment_of: 10,
  segment_start_ms: 30_000,
  track_number: 2,
  duration_ms: 30_000,
});
const OTHER = trackOf(20, "Another song");
const FIRST_ENTRY: Entry = { key: "first", trackId: FIRST.id, unit: "file:10" };
const LAST_ENTRY: Entry = { key: "last", trackId: LAST.id, unit: "file:10" };
const OTHER_ENTRY: Entry = { key: "other", trackId: OTHER.id };
const tracks = (...items: readonly Track[]) => new Map(items.map((track) => [track.id, track]));

describe("updating the playing split file", () => {
  it("does not restore a song removed from Up next by the listener", () => {
    const queue: Queue = {
      entries: [FIRST_ENTRY, OTHER_ENTRY],
      position: 0,
      repeat: "off",
      order: undefined,
    };
    const added = trackOf(13, "Bridge", {
      segment_of: 10,
      segment_start_ms: 15_000,
      track_number: 2,
      duration_ms: 15_000,
    });
    const before = tracks(FILE, FIRST, LAST, OTHER);
    const after = tracks(FILE, { ...FIRST, duration_ms: 15_000 }, added, LAST, OTHER);

    expect(updatePlayingAlbum(queue, before, after, 4, () => "new")).toBeUndefined();
  });

  it("does not reorder playback when only the displayed track number changes", () => {
    const queue: Queue = {
      entries: [FIRST_ENTRY, LAST_ENTRY],
      position: 0,
      repeat: "off",
      order: undefined,
    };

    expect(
      updatePlayingAlbum(
        queue,
        tracks(FILE, FIRST, LAST),
        tracks(FILE, { ...FIRST, track_number: 3 }, LAST),
        10,
        () => "new",
      ),
    ).toBeUndefined();
  });

  it("replaces only the playing split file when it is unsplit in a shuffled queue", () => {
    const queue: Queue = {
      entries: [OTHER_ENTRY, FIRST_ENTRY, LAST_ENTRY],
      position: 2,
      order: ["first", "last", "other"],
      repeat: "all",
    };
    const before = tracks(FILE, FIRST, LAST, OTHER);
    const after = tracks({ ...FILE, split: false }, OTHER);

    const result = updatePlayingAlbum(queue, before, after, 36, () => "whole");

    expect(result).toEqual({
      entries: [OTHER_ENTRY, { key: "whole", trackId: FILE.id, unit: undefined }],
      position: 1,
      order: ["whole", "other"],
      repeat: "all",
    });
  });

  it("keeps an unsplit file grouped with the other tracks in its album", () => {
    const unit = "album:Suite";
    const queue: Queue = {
      entries: [FIRST_ENTRY, LAST_ENTRY, OTHER_ENTRY].map((entry) => ({ ...entry, unit })),
      position: 0,
      order: undefined,
      repeat: "off",
    };

    const result = updatePlayingAlbum(
      queue,
      tracks(FILE, FIRST, LAST, OTHER),
      tracks({ ...FILE, split: false }, OTHER),
      10,
      () => "whole",
    );

    expect(result?.entries).toEqual([
      { key: "whole", trackId: FILE.id, unit },
      { ...OTHER_ENTRY, unit },
    ]);
  });
});
