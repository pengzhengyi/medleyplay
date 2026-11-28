import { type Page, expect, test } from "@playwright/test";

import type { Track } from "../src/api";

// Both tests open Alpha's songs and the first splits it, so they run one after the other,
// in a project of their own that waits for every other test (see playwright.config.ts).
test.describe.configure({ mode: "default" });

const row = (page: Page, title: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: title, exact: true }) });

test("a song list typed beside the details is checked line by line, then fills the songs", async ({
  page,
}) => {
  await page.goto("/");
  await row(page, "Alpha").getByRole("button", { name: "More actions for Alpha" }).click();
  await page.getByRole("menuitem", { name: "Edit details…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Split into songs" }).click();
  await dialog.getByRole("button", { name: "Fill from a list" }).click();
  const list = dialog.getByRole("textbox", { name: "Song list" });

  // Alpha is a minute long, so a song at 2:00 starts after it ends.
  await list.click();
  await page.keyboard.type("0:00 Intro\nNight Drive\n2:00 Encore");
  await expect(
    dialog.getByRole("button", { name: "Line 2: This line has no time, such as 3:12." }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Line 3: This starts after the file ends, at 1:00." }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("0:00 Intro\n0:30 Night Drive - Blue Room");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();

  // Saved, the details show the file split in two.
  const split = dialog.getByRole("button", { name: "2 songs" });
  await expect(split).toBeVisible();
  await split.click();
  await expect(dialog.getByRole("textbox", { name: "Title of song 2" })).toHaveValue("Night Drive");
  await expect(dialog.getByRole("textbox", { name: "Artist of song 2" })).toHaveValue("Blue Room");
  // Unsplit again, so the file is whole for the tests after.
  await dialog.getByRole("button", { name: "Unsplit", exact: true }).click();
  await dialog.getByRole("button", { name: "Unsplit and remove 2 songs" }).click();
  await expect(dialog.getByRole("button", { name: "Split into songs" })).toBeVisible();
});

test("an empty song list's caret is one line tall, not as tall as the two-line example", async ({
  page,
}) => {
  await page.goto("/");
  await row(page, "Alpha").getByRole("button", { name: "More actions for Alpha" }).click();
  await page.getByRole("menuitem", { name: "Edit details…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Split into songs" }).click();
  await dialog.getByRole("button", { name: "Fill from a list" }).click();

  const example = await dialog.locator(".cm-placeholder").boundingBox();
  const caret = await dialog.locator(".cm-cursor-primary").boundingBox();

  expect(caret?.height ?? Infinity).toBeLessThanOrEqual((example?.height ?? 0) / 2 + 1);
});

test("saving song boundaries updates the album and playing timeline in another tab", async ({
  page,
  request,
}) => {
  const tracks = (await (await request.get("/api/tracks")).json()) as Track[];
  const file = tracks.find((track) => track.title === "Alpha");
  if (file === undefined) throw new Error("Missing Alpha fixture.");
  const details = `/api/tracks/${String(file.id)}/details`;
  const songs = `/api/tracks/${String(file.id)}/songs`;
  const album = "Boundary review album";
  expect((await request.put(details, { data: { values: { album } } })).ok()).toBe(true);

  const editing = await page.context().newPage();
  try {
    expect(
      (
        await request.put(songs, {
          data: {
            rows: [
              { start_ms: 0, title: "Opening" },
              { start_ms: 30_000, title: "Second half" },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    const url = `/#/album?artist=&name=${encodeURIComponent(album)}`;
    await page.goto(url);
    const opening = row(page, "Opening");
    await expect(opening.getByRole("cell", { name: "0:30", exact: true })).toBeVisible();
    await opening.getByRole("button", { name: "Opening", exact: true }).click();
    const player = page.getByRole("region", { name: "Player" });
    const parts = player.locator(".seek-segment");
    await expect(parts).toHaveCount(2);
    await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
    await editing.goto(url);
    await row(editing, "Opening").getByRole("button", { name: "More actions for Opening" }).click();
    await editing.getByRole("menuitem", { name: "Edit songs…" }).click();
    const editor = editing.getByRole("dialog");
    await editor.getByRole("textbox", { name: "Start of song 2" }).fill("0:20");
    await editor.getByRole("button", { name: "Add a song" }).click();
    await editor.getByRole("textbox", { name: "Start of song 3" }).fill("0:40");
    await editor.getByRole("textbox", { name: "Title of song 3" }).fill("Encore");
    await editor.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      row(editing, "Opening").getByRole("cell", { name: "0:20", exact: true }),
    ).toBeVisible();
    await expect(opening.getByRole("cell", { name: "0:20", exact: true })).toBeVisible();
    await expect(row(page, "Encore")).toBeVisible();
    await expect(parts).toHaveCount(3);
    await expect(parts.first()).toHaveCSS("--width", String(20 / 60));
    await expect(
      player.getByRole("button", { name: `Album: ${album}, song 1 of 3` }),
    ).toBeVisible();
    await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  } finally {
    await editing.close();
    expect((await request.delete(songs)).ok()).toBe(true);
    expect(
      (
        await request.post("/api/tracks/details", {
          data: { track_ids: [file.id], values: { album: null } },
        })
      ).ok(),
    ).toBe(true);
  }
});

test("segmented seek thumbs align and leave album previews reachable in both layouts", async ({
  page,
  request,
}) => {
  const tracks = (await (await request.get("/api/tracks")).json()) as Track[];
  const file = tracks.find((track) => track.title === "Alpha");
  if (file === undefined) throw new Error("Missing Alpha fixture.");
  const details = `/api/tracks/${String(file.id)}/details`;
  const songs = `/api/tracks/${String(file.id)}/songs`;
  const album = "Seek geometry album";
  expect((await request.put(details, { data: { values: { album } } })).ok()).toBe(true);
  try {
    expect(
      (
        await request.put(songs, {
          data: {
            rows: [
              { start_ms: 0, title: "Opening" },
              { start_ms: 30_000, title: "Second half" },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/#/album?artist=&name=${encodeURIComponent(album)}`);
    await page.getByRole("button", { name: "Opening", exact: true }).click();
    const player = page.getByRole("region", { name: "Player" });
    await player.getByRole("button", { name: "Pause" }).click();

    for (const inDialog of [false, true]) {
      if (inDialog) await player.getByRole("button", { name: "Open Now Playing" }).click();
      const scope = inDialog ? page.getByRole("dialog", { name: "Now Playing" }) : player;
      const bar = scope.getByRole("slider", { name: "Position" });
      await expect(bar.locator(".seek-segment")).toHaveCount(2);
      await expect(bar).toHaveAttribute("aria-valuemax", "60");
      await bar.focus();
      await page.keyboard.press("Home");
      for (let press = 0; press < 3; press++) await page.keyboard.press("PageUp");
      await expect(bar).toHaveJSProperty("ariaValueNow", "18");
      const error = await bar.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const dot = element.querySelector(".seek-thumb")?.getBoundingClientRect();
        if (dot === undefined) throw new Error("Missing seek thumb.");
        return Math.abs(dot.left + dot.width / 2 - (box.left + box.width * 0.3));
      });
      expect(error).toBeLessThan(0.75);
      const box = await bar.boundingBox();
      if (box === null) throw new Error("Missing seek bar.");

      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);

      await expect(bar.locator(".seek-tip")).toContainText("Opening");
      const preview = bar.locator(".seek-preview");
      await expect(preview).toBeVisible();
      await preview.hover();
      await expect(preview).toBeVisible();
      await expect(bar).toHaveJSProperty("ariaValueNow", "18");
    }
  } finally {
    expect((await request.delete(songs)).ok()).toBe(true);
    expect(
      (
        await request.post("/api/tracks/details", {
          data: { track_ids: [file.id], values: { album: null } },
        })
      ).ok(),
    ).toBe(true);
  }
});
