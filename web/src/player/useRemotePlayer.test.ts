import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpeakerState } from "../api";
import { serve, speakerStateOf, trackOf } from "../testing/server";
import {
  BLOCKED_ON_THE_COMPUTER,
  NOT_RESPONDING_MS,
  SHOWN_AT_ONCE_MS,
  type Speaker,
  takeOf,
} from "./remote";
import { useRemotePlayer } from "./useRemotePlayer";

const NOW = Date.UTC(2026, 10, 8, 20, 0, 0);

function speakerOf(change: Partial<SpeakerState> = {}, reportedAt = NOW): Speaker {
  return { page: "host-page-0001", state: speakerStateOf(change), reportedAt };
}

/** A server whose computer takes every command, recording each one sent. */
function takingCommands() {
  const sent: unknown[] = [];
  serve({
    "POST /api/remote/commands": (body) => {
      sent.push((body as { command: unknown }).command);
      return { status: 204 };
    },
  });
  return sent;
}

function renderRemote(speaker: Speaker | null, { inUse = true }: { inUse?: boolean } = {}) {
  return renderHook(({ shown }) => useRemotePlayer(shown, inUse, vi.fn()), {
    initialProps: { shown: speaker },
  });
}

/** Lemon playing on a phone from 30 s in, to move onto the computer. */
const LEMON_ON_THE_PHONE = takeOf(
  {
    queue: { entries: [{ key: "p1", trackId: 1 }], position: 0, repeat: "off", order: undefined },
    seconds: 30,
    counted: false,
  },
  true,
);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a remote's player", () => {
  it("shows what the computer plays, as its queue", () => {
    const { result } = renderRemote(speakerOf());

    const [player] = result.current;

    expect(player.queue.entries.map((entry) => entry.trackId)).toEqual([1, 2]);
    expect([player.status, player.position, player.volume]).toEqual([
      { kind: "playing" },
      12.5,
      0.8,
    ]);
  });

  it("counts the seconds on while the computer plays", () => {
    const { result } = renderRemote(speakerOf());

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current[0].position).toBe(14.5);
  });

  it("is idle with no computer playing", () => {
    const { result } = renderRemote(null);

    expect(result.current[0].status).toEqual({ kind: "idle" });
  });

  it("pauses at once, before the computer reports, and asks the computer to", async () => {
    const sent = takingCommands();
    const { result } = renderRemote(speakerOf());

    act(() => {
      result.current[0].toggle();
    });

    expect(result.current[0].status).toEqual({ kind: "paused" });
    await vi.waitFor(() => {
      expect(sent).toEqual([{ kind: "toggle" }]);
    });
  });

  it("shows what the computer reports after a command, over what it showed at once", () => {
    takingCommands();
    const { result, rerender } = renderRemote(speakerOf());
    act(() => {
      result.current[0].toggle();
    });

    vi.setSystemTime(NOW + 100);
    rerender({ shown: speakerOf({}, NOW + 100) });

    expect(result.current[0].status).toEqual({ kind: "playing" });
  });

  it("shows what the computer reports again when no report follows a play for a while", () => {
    takingCommands();
    const { result } = renderRemote(speakerOf({ status: "blocked", message: "Press play." }));
    act(() => {
      result.current[0].toggle();
    });

    act(() => {
      vi.advanceTimersByTime(SHOWN_AT_ONCE_MS + 500);
    });

    expect(result.current[0].status).toEqual({ kind: "blocked", message: BLOCKED_ON_THE_COMPUTER });
  });

  it("doesn't count the seconds while not in use, so the page isn't redrawn", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useRemotePlayer(speakerOf(), false, vi.fn());
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(renders).toBe(1);
  });

  it("moves the music onto the computer after the commands sent before", async () => {
    const sent = takingCommands();
    const { result } = renderRemote(speakerOf());

    let moved: Promise<void> | undefined;
    act(() => {
      result.current[0].next();
      moved = result.current[2](LEMON_ON_THE_PHONE);
    });

    await moved;
    expect(sent).toEqual([{ kind: "next" }, LEMON_ON_THE_PHONE]);
  });

  it("says why a move was refused to the one moving, not in the player", async () => {
    serve({
      "POST /api/remote/commands": { status: 429, body: { detail: "Too many commands waiting." } },
    });
    const { result } = renderRemote(speakerOf());

    const moved = result.current[2](LEMON_ON_THE_PHONE);

    await expect(moved).rejects.toThrow("Too many commands waiting.");
    expect(result.current[0].status).toEqual({ kind: "playing" });
  });

  it("sends its commands one at a time, in the order they were made", async () => {
    const sent = takingCommands();
    const { result } = renderRemote(speakerOf());
    const two = trackOf(2, "Flamingo");

    act(() => {
      result.current[0].next();
      result.current[0].add(two);
      result.current[0].playNow(two);
      result.current[0].seek(30);
    });

    await vi.waitFor(() => {
      expect(sent).toEqual([
        { kind: "next" },
        { kind: "add", entry: { track_id: 2, unit: null } },
        { kind: "playNow", entry: { track_id: 2, unit: null } },
        { kind: "seek", key: "a", seconds: 30 },
      ]);
    });
  });

  it("sends a dragged volume at most every 150 ms, and the last always", async () => {
    const sent = takingCommands();
    const { result } = renderRemote(speakerOf());

    act(() => {
      result.current[0].setVolume(0.5);
      result.current[0].setVolume(0.4);
      result.current[0].setVolume(0.3);
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    await vi.waitFor(() => {
      expect(sent).toEqual([
        { kind: "volume", volume: 0.5 },
        { kind: "volume", volume: 0.3 },
      ]);
    });
  });

  it("says why the computer refused a command", async () => {
    serve({
      "POST /api/remote/commands": {
        status: 409,
        body: { detail: "Nothing is playing on the computer; open medleyplay there." },
      },
    });
    const { result } = renderRemote(speakerOf());

    act(() => {
      result.current[0].next();
    });

    await vi.waitFor(() => {
      expect(result.current[0].status).toEqual({
        kind: "failed",
        message: "Nothing is playing on the computer; open medleyplay there.",
      });
    });
  });

  it("says the computer isn't responding once its reports stop", () => {
    const { result } = renderRemote(speakerOf({ status: "paused" }));

    act(() => {
      vi.advanceTimersByTime(NOT_RESPONDING_MS + 500);
    });

    expect(result.current[0].status).toEqual({
      kind: "failed",
      message: "The computer isn't responding.",
    });
  });

  it("asks for a click on the computer when its browser won't play", () => {
    const { result } = renderRemote(speakerOf({ status: "blocked", message: "Press play." }));

    expect(result.current[0].status).toEqual({
      kind: "blocked",
      message: BLOCKED_ON_THE_COMPUTER,
    });
  });

  it("shows the computer's sleep timer and sets it there", async () => {
    const sent = takingCommands();
    const { result } = renderRemote(speakerOf({ sleep: { left_ms: 600_000, set_ms_ago: 60_000 } }));

    const [, sleep] = result.current;
    act(() => {
      sleep.start(30);
    });

    expect([sleep.endsAt, sleep.setAt]).toEqual([NOW + 600_000, NOW - 60_000]);
    await vi.waitFor(() => {
      expect(sent).toEqual([{ kind: "sleep", minutes: 30 }]);
    });
  });
});
