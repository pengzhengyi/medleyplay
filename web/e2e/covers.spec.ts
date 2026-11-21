/**
 * @file Album covers suggested, against `covers`, the test plugin that stands in for
 * MusicBrainz and answers any album with one cover of its name.
 *
 * Opening an album with no cover searches it; the cover found is suggested on its page
 * and in Clean up, and using it there puts it on the album's songs.
 */

import { expect as baseExpect, test } from "@playwright/test";

// A search is a Job, which a busy machine slows; waits allow for that.
const expect = baseExpect.configure({ timeout: 15_000 });

const ALBUM = "Tube Covers";
const ARTIST = "Blue Room";

test("an album with no cover is suggested one found, and using it in Clean up shows it", async ({
  page,
  request,
}) => {
  const added = await request.post("/api/links", {
    data: { link: "BVCoverAlbum", parts: [{ part: 1, title: "Cover Song", artist: ARTIST }] },
  });
  expect(added.ok()).toBe(true);
  const [{ track_id: song }] = (await added.json()) as { readonly track_id: number }[];
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
  await expect(page.getByRole("button", { name: "Replace the cover" })).toBeVisible();
});
