import { type Page, expect, test } from "@playwright/test";

/** Wait for the server to answer a save of a Track's `what`. */
const saved = (page: Page, what: "favorite" | "rating") =>
  page.waitForResponse((response) => response.url().endsWith(`/${what}`) && response.ok());

const row = (page: Page, title: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: title, exact: true }) });

test("a favorite and a rating are kept by the server", async ({ page }) => {
  await page.goto("/");
  const heart = page.getByRole("button", { name: "Favorite Bravo" }).first();
  const stars = row(page, "Bravo").getByRole("group", { name: "Rate Bravo" });

  // Each click's save reaches the server before the reload asks it again.
  await Promise.all([saved(page, "favorite"), heart.click()]);
  await Promise.all([
    saved(page, "rating"),
    stars.getByRole("button", { name: "4 stars" }).click(),
  ]);
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.reload();

  await expect(page.getByRole("button", { name: "Favorite Bravo" }).first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(row(page, "Bravo").getByRole("button", { name: "4 stars" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Put Bravo back as the other tests expect it.
  await Promise.all([
    saved(page, "favorite"),
    page.getByRole("button", { name: "Favorite Bravo" }).first().click(),
  ]);
  await Promise.all([
    saved(page, "rating"),
    row(page, "Bravo").getByRole("button", { name: "4 stars" }).click(),
  ]);
  await expect(row(page, "Bravo").getByRole("button", { name: "4 stars" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("sorting by time plays from the sorted order", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Time", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Time" })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await page.getByRole("button", { name: "Charlie", exact: true }).click();

  const queue = page.getByRole("region", { name: "Up next" }).getByRole("listitem");
  await expect(queue).toHaveText([/Alpha/, /Bravo/, /Delta/]);
});

/** A Library of `count` songs, "Song 1" on, by 40 artists over 90 albums. */
function manySongs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Song ${String(i + 1)}`,
    artist: `Artist ${String(i % 40)}`,
    album: `Album ${String(i % 90)}`,
    album_artist: "",
    duration_ms: 180_000,
    added_at: "2026-10-01T12:00:00Z",
    favorite: false,
    rating: null,
    play_count: 0,
    last_played_at: null,
    availability: "ok",
    downloaded: false,
  }));
}

test("a large Library keeps only the rows on screen in the page", async ({ page }) => {
  const tracks = manySongs(5000);
  await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Song 1", exact: true })).toBeVisible();

  expect(await page.locator("table.tracks tbody tr:not(.spacer)").count()).toBeLessThan(100);
  await expect(page.getByRole("table")).toHaveAttribute("aria-rowcount", "5001");
  await page.mouse.wheel(0, 1_000_000);
  await expect(page.getByRole("button", { name: "Song 5000", exact: true })).toBeVisible();
  expect(await page.locator("table.tracks tbody tr:not(.spacer)").count()).toBeLessThan(100);
});

test("a song's menu adds it to a new Playlist, and then another song to the same one", async ({
  page,
}) => {
  await page.goto("/");
  const menuOf = (title: string) =>
    row(page, title).getByRole("button", { name: `More actions for ${title}` });
  const dialog = page.getByRole("dialog");

  await row(page, "Bravo").hover();
  await menuOf("Bravo").click();
  await page.getByRole("menuitem", { name: "Add to playlist…" }).click();
  await dialog.getByRole("textbox", { name: "New playlist" }).fill("Road trip");
  await dialog.getByRole("textbox", { name: "New playlist" }).press("Enter");
  await dialog.getByRole("button", { name: "Add to 1 playlist" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "Added “Bravo” to Road trip." }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await row(page, "Charlie").hover();
  await menuOf("Charlie").click();
  await page.getByRole("menuitem", { name: "Add to playlist…" }).click();
  await dialog.getByRole("checkbox", { name: /Road trip/ }).check();
  await dialog.getByRole("button", { name: "Add to 1 playlist" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.goto("/#/playlists");

  await page.getByRole("link", { name: /Road trip/ }).click();
  await expect(page.getByRole("heading", { name: "Road trip" })).toBeVisible();
  await expect(
    page.getByRole("row").filter({ has: page.getByRole("button", { name: /^(Bravo|Charlie)$/ }) }),
  ).toHaveCount(2);
});

test("the song playing has a menu too, which goes to its album", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  const player = page.getByRole("region", { name: "Player" });

  await player.getByRole("button", { name: "More actions for Alpha" }).click();

  await expect(page.getByRole("menuitem", { name: "Play next" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Go to album" }).click();
  await expect(page.getByRole("heading", { name: "Unknown album" })).toBeVisible();
  expect(page.url()).toContain("#/album?");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a large Library gives each song's title the row's free width", async ({ page }) => {
    await page.route("**/api/tracks", (route) => route.fulfill({ json: manySongs(500) }));
    await page.goto("/");
    const title = page
      .getByRole("row")
      .filter({ hasText: "Song 1" })
      .first()
      .getByRole("cell")
      .nth(1);
    await expect(title).toBeVisible();

    const table = await page.getByRole("table").boundingBox();
    const cell = await title.boundingBox();

    expect(cell?.width).toBeGreaterThan((table?.width ?? 0) * 0.6);
  });
});
