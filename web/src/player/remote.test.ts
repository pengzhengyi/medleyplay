import { describe, expect, it, vi } from "vitest";

import { playerOf, sleepTimerOf } from "../testing/player";
import { speakerStateOf, trackOf } from "../testing/server";
import { EMPTY } from "./queue";
import {
  BLOCKED_ON_THE_COMPUTER,
  REPORT_BEFORE,
  REPORT_ENTRIES,
  type Speaker,
  apply,
  handoffOf,
  queueOf,
  secondsAt,
  stateOf,
  statusOf,
  takeOf,
} from "./remote";

const NOW = Date.UTC(2026, 10, 8, 20, 0, 0);
const ONE = trackOf(1, "Lemon");
const TWO = trackOf(2, "Flamingo");
const TRACKS = new Map([ONE, TWO].map((track) => [track.id, track]));

/** A queue of `count` entries, `k0` to `k{count - 1}`, of Tracks 1 to `count`, playing `position`. */
function longQueue(count: number, position: number) {
  const entries = Array.from({ length: count }, (_, n) => ({
    key: `k${String(n)}`,
    trackId: n + 1,
  }));
  return { ...EMPTY, entries, position };
}

function speakerOf(change: Parameters<typeof speakerStateOf>[0] = {}, ago = 0): Speaker {
  return { page: "host-page-0001", state: speakerStateOf(change), reportedAt: NOW - ago };
}

/** The id of a play counted on one page and handed on to another. */
const PLAY_ID = "00000000-0000-4000-8000-0000000000a1";

describe("what the computer reports", () => {
  it("is its queue in the order it plays, and how it plays", () => {
    const state = stateOf(playerOf(), sleepTimerOf(), NOW);

    expect(state).toEqual(speakerStateOf());
  });

  it("is a window of a long queue, from a little before the entry playing", () => {
    const player = playerOf({ queue: longQueue(2000, 1000) });

    const state = stateOf(player, sleepTimerOf(), NOW);

    expect(state.offset).toBe(1000 - REPORT_BEFORE);
    expect(state.entries).toHaveLength(REPORT_ENTRIES);
    expect(state.entries[REPORT_BEFORE]?.key).toBe("k1000");
    expect([state.total, state.position]).toEqual([2000, 1000]);
  });

  it("carries the sleep timer as time left and time since it was set", () => {
    const sleep = sleepTimerOf({ endsAt: NOW + 600_000, setAt: NOW - 300_000 });

    const state = stateOf(playerOf(), sleep, NOW);

    expect(state.sleep).toEqual({ left_ms: 600_000, set_ms_ago: 300_000 });
  });

  it("says why it can't play", () => {
    const player = playerOf({ status: { kind: "blocked", message: "Press play to start." } });

    const state = stateOf(player, sleepTimerOf(), NOW);

    expect([state.status, state.message]).toEqual(["blocked", "Press play to start."]);
  });

  it("says whether the play of the entry playing has counted", () => {
    const player = playerOf();
    const counted = playerOf({
      handoff: () => ({ queue: player.queue, seconds: 12.5, counted: true }),
    });

    const state = stateOf(counted, sleepTimerOf(), NOW);

    expect(state.counted).toBe(true);
  });
});

describe("what a remote shows", () => {
  it("is the reported window as its queue, playing the reported entry", () => {
    const queue = queueOf(speakerStateOf({ offset: 10, total: 12, position: 11 }));

    expect(queue.entries.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(queue.position).toBe(1);
  });

  it("counts the seconds on from the report while it plays", () => {
    expect(secondsAt(speakerOf({}, 3000), NOW)).toBe(15.5);
  });

  it("never counts past the end of the Track", () => {
    expect(secondsAt(speakerOf({ seconds: 199 }, 5000), NOW)).toBe(200);
  });

  it("holds the second while paused", () => {
    expect(secondsAt(speakerOf({ status: "paused" }, 3000), NOW)).toBe(12.5);
  });

  it("asks for a click on the computer when its browser won't play", () => {
    expect(
      statusOf(speakerStateOf({ status: "blocked", message: "Press play to start." })),
    ).toEqual({ kind: "blocked", message: BLOCKED_ON_THE_COMPUTER });
  });
});

describe("moving the music", () => {
  it("onto the computer sends the queue, its second, and whether the play counted", () => {
    const player = playerOf();

    const command = takeOf({ queue: player.queue, seconds: 40, counted: true }, true);

    expect(command).toEqual({
      kind: "take",
      entries: [
        { key: "a", track_id: 1, unit: null },
        { key: "b", track_id: 2, unit: null },
      ],
      order: null,
      position: 0,
      repeat: "off",
      shuffled: false,
      seconds: 40,
      playing: true,
      counted: true,
      play: null,
    });
  });

  it("onto the computer hands on the play counted, with how long it was listened to", () => {
    const player = playerOf();
    const play = { id: PLAY_ID, trackId: 1, playedAt: "2026-11-09T08:00:00Z", listenedMs: 130_000 };

    const command = takeOf({ queue: player.queue, seconds: 40, counted: true, play }, true);

    expect(command).toMatchObject({
      play: { id: PLAY_ID, track_id: 1, played_at: play.playedAt, listened_ms: 130_000 },
    });
  });

  it("onto this page goes on with the computer's play", () => {
    const play = {
      id: PLAY_ID,
      track_id: 1,
      played_at: "2026-11-09T08:00:00Z",
      listened_ms: 130_000,
    };

    const handoff = handoffOf(speakerOf({ counted: true, play }), NOW);

    expect(handoff?.play).toEqual({
      id: PLAY_ID,
      trackId: 1,
      playedAt: play.played_at,
      listenedMs: 130_000,
    });
  });

  it("onto this page takes the computer's queue from the second it is at now", () => {
    const handoff = handoffOf(speakerOf({}, 2000), NOW);

    expect(handoff?.queue.entries.map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(handoff?.seconds).toBe(14.5);
  });

  it("onto this page keeps the computer's count of the play, so it isn't counted twice", () => {
    const handoff = handoffOf(speakerOf({ counted: true }), NOW);

    expect(handoff?.counted).toBe(true);
  });

  it("onto this page takes nothing when the computer has nothing queued", () => {
    expect(handoffOf(speakerOf({ entries: [], total: 0 }), NOW)).toBeUndefined();
  });
});

describe("the computer carrying out a command", () => {
  it("plays a list from the entry chosen, with each Track's unit", () => {
    const player = playerOf();

    apply(
      {
        kind: "play",
        entries: [
          { track_id: 1, unit: "file:9" },
          { track_id: 2, unit: null },
        ],
        start: 1,
      },
      player,
      TRACKS,
      sleepTimerOf(),
    );

    expect(player.playList).toHaveBeenCalledWith([ONE, TWO], 1, expect.any(Function));
    const unitOf = vi.mocked(player.playList).mock.calls[0]?.[2];
    expect([unitOf?.(ONE), unitOf?.(TWO)]).toEqual(["file:9", undefined]);
  });

  it("leaves out a Track it doesn't know, still starting from the one chosen", () => {
    const player = playerOf();

    apply(
      {
        kind: "play",
        entries: [
          { track_id: 99, unit: null },
          { track_id: 2, unit: null },
        ],
        start: 1,
      },
      player,
      TRACKS,
      sleepTimerOf(),
    );

    expect(player.playList).toHaveBeenCalledWith([TWO], 0, expect.any(Function));
  });

  it("plays a Track now, leaving what plays next as it was", () => {
    const player = playerOf();

    apply({ kind: "playNow", entry: { track_id: 2, unit: null } }, player, TRACKS, sleepTimerOf());

    expect(player.playNow).toHaveBeenCalledWith(TWO);
  });

  it("seeks only within the entry the remote saw playing", () => {
    const player = playerOf();

    apply({ kind: "seek", key: "b", seconds: 30 }, player, TRACKS, sleepTimerOf());
    apply({ kind: "seek", key: "a", seconds: 30 }, player, TRACKS, sleepTimerOf());

    expect(player.seek).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenCalledWith(30);
  });

  it("sets and stops its own sleep timer", () => {
    const sleep = sleepTimerOf();

    apply({ kind: "sleep", minutes: 30 }, playerOf(), TRACKS, sleep);
    apply({ kind: "sleep", minutes: null }, playerOf(), TRACKS, sleep);

    expect(sleep.start).toHaveBeenCalledWith(30);
    expect(sleep.stop).toHaveBeenCalledTimes(1);
  });

  it("takes a queue moved onto it, shuffled in the order sent", () => {
    const player = playerOf();

    apply(
      {
        kind: "take",
        entries: [
          { key: "b", track_id: 2, unit: null },
          { key: "a", track_id: 1, unit: null },
        ],
        order: ["a", "b"],
        position: 0,
        repeat: "all",
        shuffled: true,
        seconds: 40,
        playing: true,
        counted: false,
      },
      player,
      TRACKS,
      sleepTimerOf(),
    );

    expect(player.take).toHaveBeenCalledWith(
      {
        queue: {
          entries: [
            { key: "b", trackId: 2, unit: undefined },
            { key: "a", trackId: 1, unit: undefined },
          ],
          position: 0,
          repeat: "all",
          order: ["a", "b"],
        },
        seconds: 40,
        counted: false,
      },
      true,
    );
  });

  it.each([
    [{ kind: "toggle" } as const, "toggle"],
    [{ kind: "pause" } as const, "pause"],
    [{ kind: "next" } as const, "next"],
    [{ kind: "previous" } as const, "previous"],
    [{ kind: "clear" } as const, "clear"],
  ] as const)("does %o through the player's %s", (command, action) => {
    const player = playerOf();

    apply(command, player, TRACKS, sleepTimerOf());

    expect(player[action]).toHaveBeenCalledTimes(1);
  });
});
