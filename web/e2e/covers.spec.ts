/**
 * @file Album covers suggested, against `covers`, the test plugin that stands in for
 * MusicBrainz and answers any album with one cover of its name.
 *
 * Opening an album with no cover searches it; the cover found is suggested on its page
 * and in Clean up, and using it there puts it on the album's songs. A cover chosen in a
 * song's Edit details is its album's too.
 */

import { expect as baseExpect, test } from "@playwright/test";

// A search is a Job, which a busy machine slows; waits allow for that.
const expect = baseExpect.configure({ timeout: 15_000 });

const ARTIST = "Blue Room";

test("an album with no cover is suggested one found, and using it in Clean up shows it", async ({
  page,
  request,
}, { retry }) => {
  // A retry has a song and album of its own: the first try may have used the cover.
  const ALBUM = `Tube Covers ${String(retry + 1)}`;
  const added = await request.post("/api/links", {
    data: {
      // A Bilibili code is ten letters or digits after `BV`.
      link: `BVCoverTry0${String(retry)}`,
      parts: [{ part: 1, title: "Cover Song", artist: ARTIST }],
    },
  });
  expect(added.ok()).toBe(true);
  const [first] = (await added.json()) as { readonly track_id: number }[];
  const song = first?.track_id;
  const saved = await request.post("/api/tracks/details", {
    data: { track_ids: [song], values: { album: ALBUM } },
  });
  expect(saved.ok()).toBe(true);

  await page.goto(`/#/album?${new URLSearchParams({ artist: ARTIST, name: ALBUM }).toString()}`);
  await expect(
    page.getByRole("button", { name: `Use the suggested cover of ${ALBUM}` }),
  ).toBeVisible();

  await page.goto("/#/clean-up");
  const section = page.getByRole("region", { name: /^Find album covers/u });
  await section.getByRole("button", { name: `Use the suggested cover of ${ALBUM}` }).click();

  await expect(section.getByRole("list", { name: "Covers suggested" })).toBeHidden();
  await page.goto(`/#/album?${new URLSearchParams({ artist: ARTIST, name: ALBUM }).toString()}`);
  await expect(page.getByRole("button", { name: "Replace album cover" })).toBeVisible();
});

/** A PNG of one pixel. */
const ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a cover chosen in a song's Edit details goes on its album's other songs, and Edit details stays open", async ({
  page,
  request,
}, { retry }) => {
  // A retry has an album of its own: the first try may have given it a cover.
  const ALBUM = `Tube Edit Cover ${String(retry + 1)}`;
  const ids: number[] = [];
  for (const [mark, title] of [
    ["A", "Edit Cover One"],
    ["B", "Edit Cover Two"],
  ] as const) {
    const added = await request.post("/api/links", {
      data: {
        link: `BVEdiCover${mark}${String(retry)}`,
        parts: [{ part: 1, title, artist: ARTIST }],
      },
    });
    expect(added.ok()).toBe(true);
    const [first] = (await added.json()) as { readonly track_id: number }[];
    ids.push(first?.track_id ?? 0);
  }
  const saved = await request.post("/api/tracks/details", {
    data: { track_ids: ids, values: { album: ALBUM } },
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`/#/album?${new URLSearchParams({ artist: ARTIST, name: ALBUM }).toString()}`);
  await page.getByRole("button", { name: "More actions for Edit Cover One" }).click();
  await page.getByRole("menuitem", { name: "Edit details…" }).click();
  const details = page.getByRole("dialog", { name: "Edit details" });

  await details.getByRole("button", { name: "Add album cover…" }).click();
  const editor = page.getByRole("dialog", { name: "Add album cover" });
  await expect(editor).toHaveAccessibleDescription(
    `${ALBUM} Cover changes apply immediately to the 2 songs of “${ALBUM}”.`,
  );
  await editor.getByLabel("Choose a cover file").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL,
  });
  await editor.getByRole("button", { name: "Use this cover" }).click();

  await expect(editor).toBeHidden();
  await expect(details).toBeVisible();
  await expect(details.getByRole("img", { name: "Cover" })).toHaveAttribute(
    "src",
    /^\/api\/covers\//u,
  );
  // Both songs now show the one cover chosen.
  await expect
    .poll(async () => {
      const tracks = (await (await request.get("/api/tracks")).json()) as {
        readonly id: number;
        readonly cover: string | null;
      }[];
      const [one, two] = ids.map((each) => tracks.find(({ id }) => id === each)?.cover ?? null);
      return one !== null && one === two ? "one cover" : `${String(one)} and ${String(two)}`;
    })
    .toBe("one cover");
});
