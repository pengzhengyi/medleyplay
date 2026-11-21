import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, HeldReads, THUMBNAIL_RECIPE, api, coverUrl, uploadFile } from "./api";
import { downloadOf, serve } from "./testing/server";
import { FakeUploads } from "./testing/uploads";

describe("where a cover is served", () => {
  const BREMEN = "5f3b6c9e0a1d2f4b8c7e6a5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a291";

  it("serves the original as it was kept", () => {
    expect(coverUrl(BREMEN, "original")).toBe(`/api/covers/${BREMEN}`);
  });

  it("serves a thumbnail by its size and the recipe it is made by", () => {
    expect(coverUrl(BREMEN, "small")).toBe(`/api/covers/${BREMEN}?size=small&recipe=1`);
    expect(coverUrl(BREMEN, "medium")).toBe(`/api/covers/${BREMEN}?size=medium&recipe=1`);
    expect(THUMBNAIL_RECIPE).toBe(1);
  });
});

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

/** A `fetch` that answers each request only when the test says, noting what each asked. */
class HeldFetch {
  readonly asked: { readonly path: string; readonly etag: string | null }[] = [];
  private readonly waiting: ((response: Response) => void)[] = [];

  static install(): HeldFetch {
    const fake = new HeldFetch();
    vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      fake.asked.push({ path, etag: headers.get("If-None-Match") });
      return new Promise<Response>((resolve) => fake.waiting.push(resolve));
    });
    return fake;
  }

  /** Answer the oldest request still waiting. */
  async answer(status: number, body?: unknown, etag?: string): Promise<void> {
    const resolve = this.waiting.shift();
    if (resolve === undefined) {
      throw new Error("No request is waiting for an answer.");
    }
    const headers: Record<string, string> = etag === undefined ? {} : { ETag: etag };
    resolve(
      new Response(status === 304 ? null : JSON.stringify(body ?? { detail: "Refused" }), {
        status,
        headers,
      }),
    );
    // Let the reader take the answer in.
    await new Promise((settled) => setTimeout(settled, 0));
  }
}

describe("a held read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SONGS = [{ id: 1, title: "Intro" }];

  it("asks with no ETag the first time and with the one it holds after", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();

    const first = reads.read("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    await first;
    const again = reads.read("/api/tracks");
    await server.answer(304);
    await again;

    expect(server.asked).toEqual([
      { path: "/api/tracks", etag: null },
      { path: "/api/tracks", etag: 'W/"a"' },
    ]);
  });

  it("gives back the very answer it holds when the server says it is unchanged", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();
    const first = reads.read("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    const held = await first;

    const again = reads.read("/api/tracks");
    await server.answer(304);

    expect(await again).toBe(held);
  });

  it("holds a new answer in place of the old one, with its ETag", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();
    const first = reads.read("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    const old = await first;

    const second = reads.read("/api/tracks");
    await server.answer(200, [...SONGS, { id: 2, title: "Outro" }], 'W/"b"');
    const newer = await second;
    const third = reads.read("/api/tracks");
    await server.answer(304);

    expect(newer).not.toBe(old);
    expect(await third).toBe(newer);
    expect(server.asked.at(-1)?.etag).toBe('W/"b"');
  });

  it("keeps what it holds when a read is refused", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();
    const first = reads.read("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    const held = await first;

    const refused = expect(reads.read("/api/tracks")).rejects.toThrow(ApiError);
    await server.answer(500);
    await refused;
    const again = reads.read("/api/tracks");
    await server.answer(304);

    expect(server.asked.at(-1)?.etag).toBe('W/"a"');
    expect(await again).toBe(held);
  });

  it("refuses a 304 when it holds nothing to give back", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();

    const read = expect(reads.read("/api/tracks")).rejects.toThrow(ApiError);
    await server.answer(304);

    await read;
  });

  it("asks once more after the read under way, for every caller who asked meanwhile", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();
    const first = reads.read("/api/tracks");

    const second = reads.read("/api/tracks");
    const third = reads.read("/api/tracks");
    const askedWhileFirstRan = server.asked.length;
    await server.answer(200, SONGS, 'W/"a"');
    await server.answer(200, [{ id: 2, title: "Outro" }], 'W/"b"');

    expect(askedWhileFirstRan).toBe(1);
    expect(server.asked).toHaveLength(2);
    expect(await first).toEqual(SONGS);
    expect(await second).toBe(await third);
    expect(await second).toEqual([{ id: 2, title: "Outro" }]);
  });

  it("reads each path on its own", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();

    const songs = reads.read("/api/tracks");
    const names = reads.read("/api/artist-names");

    expect(server.asked.map((each) => each.path)).toEqual(["/api/tracks", "/api/artist-names"]);
    await server.answer(200, SONGS, 'W/"a"');
    await server.answer(200, { names: [] }, 'W/"n"');
    expect(await songs).toEqual(SONGS);
    expect(await names).toEqual({ names: [] });
  });

  it("forgets everything it holds, even an answer still on its way", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();
    const first = reads.read("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    await first;
    const late = reads.read("/api/artist-names");

    reads.forget();
    await server.answer(200, { names: [] }, 'W/"n"');
    await late;
    const songs = reads.read("/api/tracks");
    const names = reads.read("/api/artist-names");

    expect(server.asked.slice(-2)).toEqual([
      { path: "/api/tracks", etag: null },
      { path: "/api/artist-names", etag: null },
    ]);
    await server.answer(200, SONGS, 'W/"a"');
    await server.answer(200, { names: [] }, 'W/"n"');
    await Promise.all([songs, names]);
  });

  it("hands out frozen answers in development, so no caller can change what is held", async () => {
    const server = HeldFetch.install();
    const reads = new HeldReads();

    const read = reads.read<{ id: number; title: string }[]>("/api/tracks");
    await server.answer(200, SONGS, 'W/"a"');
    const songs = await read;

    expect(Object.isFrozen(songs)).toBe(true);
    expect(Object.isFrozen(songs[0])).toBe(true);
  });
});
