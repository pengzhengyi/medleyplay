import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteCommand } from "../api";
import { PAGE_ID } from "../page";
import { playerOf, sleepTimerOf } from "../testing/player";
import { serve, speakerStateOf } from "../testing/server";
import { EMPTY } from "./queue";
import { HEARTBEAT_MS, REPORT_EVERY_MS, type Speaker } from "./remote";
import type { Player } from "./usePlayer";
import { useSpeaker } from "./useSpeaker";

const NOW = Date.UTC(2026, 10, 8, 20, 0, 0);
const THIS_PAGE_PLAYS: Speaker = { page: PAGE_ID, state: speakerStateOf(), reportedAt: NOW };
const ANOTHER_TAB_PLAYS: Speaker = { ...THIS_PAGE_PLAYS, page: "another-tab-0001" };

/** A server taking every report, recording each one's body. */
function takingReports() {
  const reports: Record<string, unknown>[] = [];
  serve({
    "PUT /api/remote/report": (body) => {
      reports.push(body as Record<string, unknown>);
      return { body: { speaker: true } };
    },
  });
  return reports;
}

/** Commands, as the event stream would hear them, told to whoever listens. */
function commandStream() {
  const listeners = new Set<(command: RemoteCommand) => void>();
  return {
    onCommand: (listener: (command: RemoteCommand) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hear: (command: RemoteCommand) => {
      for (const listener of listeners) {
        listener(command);
      }
    },
  };
}

function renderSpeaker(
  player: Player,
  {
    onHost = true,
    speaker = null,
    answered = true,
  }: { onHost?: boolean; speaker?: Speaker | null; answered?: boolean } = {},
) {
  const stream = commandStream();
  const rendered = renderHook(
    ({ playing, heard }: { playing: Player; heard: Speaker | null | undefined }) => {
      useSpeaker(onHost, playing, sleepTimerOf(), new Map(), heard, stream.onCommand);
    },
    { initialProps: { playing: player, heard: answered ? speaker : undefined } },
  );
  return { ...rendered, hear: stream.hear };
}

/** Let whatever reports are due go out. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(REPORT_EVERY_MS));
}

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

describe("the computer playing for the Account", () => {
  it("reports what it plays, naming its page", async () => {
    const reports = takingReports();

    renderSpeaker(playerOf());

    await vi.waitFor(() => {
      expect(reports).toEqual([{ page: PAGE_ID, ...speakerStateOf() }]);
    });
  });

  it("reports nothing with nothing queued", async () => {
    const reports = takingReports();

    renderSpeaker(playerOf({ queue: EMPTY, status: { kind: "idle" } }));

    await Promise.resolve();
    expect(reports).toEqual([]);
  });

  it("reports nothing from a page that isn't on the computer", async () => {
    const reports = takingReports();

    renderSpeaker(playerOf(), { onHost: false });

    await Promise.resolve();
    expect(reports).toEqual([]);
  });

  it("reports once its event stream has answered, not before, so a queue restored meanwhile plays for the Account", async () => {
    const reports = takingReports();
    const paused = playerOf({ status: { kind: "paused" } });
    const { rerender } = renderSpeaker(paused, { answered: false });
    await settle();
    const before = reports.length;

    rerender({ playing: paused, heard: null });

    await vi.waitFor(() => {
      expect([before, reports.length]).toEqual([0, 1]);
    });
  });

  it("doesn't report again when another tab becomes the speaker, so two tabs don't take turns", async () => {
    const reports = takingReports();
    const playing = playerOf();
    const { rerender } = renderSpeaker(playing, { speaker: THIS_PAGE_PLAYS });
    await vi.waitFor(() => {
      expect(reports).toHaveLength(1);
    });

    rerender({ playing, heard: ANOTHER_TAB_PLAYS });

    await settle();
    expect(reports).toHaveLength(1);
  });

  it("reports at most once in a while, sending the latest", async () => {
    const reports = takingReports();
    const paused = playerOf({ status: { kind: "paused" } });
    const { rerender } = renderSpeaker(paused);
    await vi.waitFor(() => {
      expect(reports).toHaveLength(1);
    });
    await act(() => vi.advanceTimersByTimeAsync(1));

    rerender({ playing: { ...paused, volume: 0.5 }, heard: null });
    rerender({ playing: { ...paused, volume: 0.4 }, heard: null });

    await vi.waitFor(() => {
      expect(reports.map((report) => report.volume)).toEqual([0.8, 0.4]);
    });
  });

  it("reports again when its position jumps, as after a seek", async () => {
    const reports = takingReports();
    const paused = playerOf({ status: { kind: "paused" } });
    const { rerender } = renderSpeaker(paused);
    await vi.waitFor(() => {
      expect(reports).toHaveLength(1);
    });

    rerender({ playing: { ...paused, position: 90 }, heard: null });

    await vi.waitFor(() => {
      expect(reports.map((report) => report.seconds)).toEqual([12.5, 90]);
    });
  });

  it("reports though nothing changed while it plays for the Account, so remotes know it answers", async () => {
    const reports = takingReports();
    renderSpeaker(playerOf({ status: { kind: "paused" } }), { speaker: THIS_PAGE_PLAYS });
    await vi.waitFor(() => {
      expect(reports).toHaveLength(1);
    });

    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });

    await vi.waitFor(() => {
      expect(reports).toHaveLength(2);
    });
  });

  it("carries out what a remote asks", () => {
    takingReports();
    const player = playerOf();
    const { hear } = renderSpeaker(player);

    hear({ kind: "next" });

    expect(player.next).toHaveBeenCalledTimes(1);
  });

  it("carries out nothing on a page that isn't on the computer", () => {
    takingReports();
    const player = playerOf();
    const { hear } = renderSpeaker(player, { onHost: false });

    hear({ kind: "next" });

    expect(player.next).not.toHaveBeenCalled();
  });
});
