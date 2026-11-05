import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, uploadFile } from "./api";
import { downloadOf, serve } from "./testing/server";
import { FakeUploads } from "./testing/uploads";

describe("a refused request", () => {
  it("says each check the request failed, as the server lists them", async () => {
    serve({
      "PUT /api/tracks/104/songs": {
        status: 422,
        body: {
          detail: [
            { loc: ["body", "rows"], msg: "List should have at most 300 items after validation" },
            { loc: ["body", "known"], msg: "Input should be a valid integer" },
          ],
        },
      },
    });

    const refused = api.saveSongs(104, [], []);

    await expect(refused).rejects.toThrow(ApiError);
    await expect(refused).rejects.toThrow(
      "List should have at most 300 items after validation; Input should be a valid integer",
    );
  });

  it("says that it was refused when the server gave no reason", async () => {
    serve({ "DELETE /api/tracks/104/songs": { status: 500, body: "Internal Server Error" } });

    await expect(api.unsplit(104)).rejects.toThrow("The server refused this (500).");
  });
});

describe("sending a file as a Track's download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SONG = new File(["abcd"], "night drive.m4a");

  it("puts the file as the body, named in the query, and reads the answer", async () => {
    const uploads = FakeUploads.install();

    const sent = uploadFile(3, SONG, () => undefined);
    uploads.last.answer(200, JSON.stringify(downloadOf(3, "downloaded")));

    expect(await sent).toEqual(downloadOf(3, "downloaded"));
    expect([uploads.last.method, uploads.last.url, uploads.last.body]).toEqual([
      "PUT",
      "/api/tracks/3/download?name=night%20drive.m4a",
      SONG,
    ]);
  });

  it("reports how many bytes went as they do", () => {
    const uploads = FakeUploads.install();
    const progress: [number, number][] = [];

    void uploadFile(3, SONG, (sent, total) => progress.push([sent, total]));
    uploads.last.progress(1, 4);
    uploads.last.progress(4, 4);

    expect(progress).toEqual([
      [1, 4],
      [4, 4],
    ]);
  });

  it("says why the server refused the file", async () => {
    const uploads = FakeUploads.install();

    const sent = uploadFile(3, SONG, () => undefined);
    uploads.last.answer(413, JSON.stringify({ detail: "The file is larger than 1 GiB." }));

    await expect(sent).rejects.toThrow(new ApiError(413, "The file is larger than 1 GiB."));
  });

  it("stops when aborted, rejecting with an AbortError", async () => {
    const uploads = FakeUploads.install();
    const stop = new AbortController();

    const sent = uploadFile(3, SONG, () => undefined, stop.signal);
    stop.abort();

    await expect(sent).rejects.toMatchObject({ name: "AbortError" });
    expect(uploads.last.aborted).toBe(true);
  });

  it("says when the file never reached the server", async () => {
    const uploads = FakeUploads.install();

    const sent = uploadFile(3, SONG, () => undefined);
    uploads.last.fail();

    await expect(sent).rejects.toThrow(new ApiError(0, "The file didn't reach the server."));
  });
});
