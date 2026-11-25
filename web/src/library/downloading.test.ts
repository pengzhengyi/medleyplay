import { describe, expect, it } from "vitest";

import type { DownloadUnderWay, JobEvent } from "../api";
import { downloadEnded, downloadStateOf, followDownload } from "./downloading";

/** Track 7's Download, its Job 70 `state`, `fraction` of the way through. */
function downloadOf(
  state: DownloadUnderWay["job"]["state"] = "queued",
  fraction: number | null = null,
  waits = false,
): DownloadUnderWay {
  return {
    track_id: 7,
    job: {
      id: 70,
      state,
      progress: state === "running" ? { fraction, message: "Downloading" } : null,
      waits_for_online: waits,
      retry_at: null,
      failure_message: "",
    },
  };
}

/** Job `id`'s event: a `download_source` Job in `state`, `fraction` of the way through. */
function eventOf(id: number, state: JobEvent["state"], fraction: number | null = null): JobEvent {
  return {
    id,
    kind: "download_source",
    state,
    target: "source:9",
    progress: state === "running" ? { fraction, message: "Downloading" } : null,
    waits_for_online: false,
  };
}

describe("following the Downloads under way", () => {
  it("moves a Download on as its Job runs", () => {
    const { next, reread } = followDownload([downloadOf()], eventOf(70, "running", 0.4));

    expect(next).toEqual([downloadOf("running", 0.4)]);
    expect(reread).toBe(false);
  });

  it("drops a Download once its Job ends, however it ends", () => {
    for (const state of ["succeeded", "failed", "cancelled"] as const) {
      expect(followDownload([downloadOf()], eventOf(70, state)).next).toEqual([]);
    }
  });

  it("reads the list again for a Download it doesn't hold yet", () => {
    const { next, reread } = followDownload([downloadOf()], eventOf(71, "queued"));

    expect(next).toEqual([downloadOf()]);
    expect(reread).toBe(true);
  });

  it("leaves the list as it is for any other Job", () => {
    const lookup = { ...eventOf(71, "running"), kind: "enrich_track" };

    expect(followDownload([downloadOf()], lookup)).toEqual({
      next: [downloadOf()],
      reread: false,
    });
  });
});

describe("downloadEnded", () => {
  it("is a Download's Job that succeeded, failed, or was cancelled", () => {
    const ended = (["succeeded", "failed", "cancelled"] as const).map((state) =>
      downloadEnded({ id: 1, kind: "download_source", state }),
    );

    expect(ended).toEqual([true, true, true]);
  });

  it("is not one still under way, nor another kind of Job that ended", () => {
    expect([
      downloadEnded({ id: 1, kind: "download_source", state: "running" }),
      downloadEnded({ id: 1, kind: "scan_library", state: "succeeded" }),
    ]).toEqual([false, false]);
  });
});

describe("how far a Download has got", () => {
  it.each([
    [downloadOf("queued", null, true), "Waiting for Online"],
    [downloadOf("queued"), "Queued"],
    [downloadOf("running", null), "Downloading"],
    [downloadOf("running", 0.426), "43%"],
  ])("is said in a word or two: %#", (download, said) => {
    expect(downloadStateOf(download)).toBe(said);
  });

  it("distinguishes scheduled retries from queued downloads and clears the retry on start", () => {
    const retry = followDownload([downloadOf()], {
      ...eventOf(70, "queued"),
      retry_at: "2026-11-25T06:00:00Z",
    }).next;
    const running = followDownload(retry, {
      ...eventOf(70, "running"),
      progress: null,
      retry_at: null,
    }).next;

    expect(retry.map(downloadStateOf)).toEqual(["Retry scheduled"]);
    expect(running.map(downloadStateOf)).toEqual(["Preparing download"]);
  });

  it("shows the part being joined beside overall progress", () => {
    const { next } = followDownload([downloadOf()], {
      ...eventOf(70, "running"),
      progress: { fraction: 0.625, message: "Joining part 3 (2/4)" },
    });

    expect(next.map(downloadStateOf)).toEqual(["Joining part 3 (2/4) · 63%"]);
  });
});
