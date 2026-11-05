/**
 * @file Adding music from Bilibili against `tube`, the test plugin that stands in for it:
 * a code or link, a video that can't be read, a failed Download, and a file added by hand.
 *
 * Each test uses a video of its own, since the tests share one server.
 */

import { type Page, expect as baseExpect, test } from "@playwright/test";

// Playback runs on the audio clock, which a busy machine slows; waits allow for that.
const expect = baseExpect.configure({ timeout: 15_000 });

/** A silent 8 kHz, 8-bit, mono WAV file of `seconds` seconds. */
function wavFile(name: string, seconds: number) {
  const samples = Buffer.alloc(8000 * seconds, 0x80);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return { name, mimeType: "audio/wav", buffer: Buffer.concat([header, samples]) };
}

/** Search Bilibili for `text`, which opens the add dialog. */
async function lookUp(page: Page, text: string) {
  await page.goto("/");
  await page.getByRole("radio", { name: "Bilibili" }).check();
  const box = page.getByRole("searchbox", { name: "Search" });
  await box.fill(text);
  await box.press("Enter");
  return page.getByRole("dialog", { name: "Add from Bilibili" });
}

const row = (page: Page, title: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: title, exact: true }) });

test("a Bilibili code opens the add dialog, and adding it makes a Track that downloads", async ({
  page,
}) => {
  const dialog = await lookUp(page, "BV1Xx41117Tz");
  await expect(dialog.getByText("【MV】Night Drive")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title of part 1" })).toHaveValue("Night Drive");

  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("Added 1 song. They are downloading.")).toBeVisible();
  await expect(
    row(page, "Night Drive").getByRole("button", { name: "Favorite Night Drive" }),
  ).toBeVisible();
  await expect(row(page, "Night Drive").getByText("Download failed")).toBeHidden();
});

test("a failed Download says so, and the file added by hand plays", async ({ page }) => {
  const dialog = await lookUp(page, "https://www.bilibili.com/video/BVrefused");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row(page, "BVrefused").getByText("Download failed")).toBeVisible();

  await row(page, "BVrefused").getByRole("button", { name: "Add the file…" }).click();
  const adding = page.getByRole("dialog", { name: "Add the file for “BVrefused”" });
  await expect(adding.getByRole("status")).toHaveText(
    "The download failed: Bilibili refused the login.",
  );
  await expect(adding.getByText("yt-dlp --proxy", { exact: false })).toBeVisible();
  await expect(
    adding.getByText("https://www.bilibili.com/video/BVrefused?p=1").first(),
  ).toBeVisible();
  await adding.getByLabel("File").setInputFiles(wavFile("refused.wav", 5));
  await adding.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("Added the file for “BVrefused”.")).toBeVisible();
  await expect(row(page, "BVrefused").getByText("Download failed")).toBeHidden();
  await page.getByRole("button", { name: "BVrefused", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.5);
});

test("a video that cannot be read is added on the details given, then gets its file from the menu", async ({
  page,
}) => {
  const dialog = await lookUp(page, "https://www.bilibili.com/video/BVdown?p=2");
  await expect(dialog.getByRole("alert")).toContainText("The site couldn’t be reached.");
  await expect(dialog.getByRole("spinbutton", { name: "Part number 1" })).toHaveValue("2");
  await dialog.getByRole("textbox", { name: "Title of part 1" }).fill("Side B");
  await dialog.getByRole("textbox", { name: "Artist of part 1" }).fill("Blue Room");

  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(row(page, "Side B")).toBeVisible();
  await page.getByRole("button", { name: "More actions for Side B" }).click();
  await page.getByRole("menuitem", { name: "Add the file yourself…" }).click();
  const adding = page.getByRole("dialog", { name: "Add the file for “Side B”" });
  await adding.getByLabel("File").setInputFiles(wavFile("side-b.wav", 3));
  await adding.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added the file for “Side B”.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Side B", exact: true })).toBeEnabled();
});

const WIDTHS = [320, 390, 1280];

test("at phone, small phone, and laptop widths the add dialogs never scroll sideways", async ({
  page,
}) => {
  const sideways = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
  const dialogSideways = (name: string) =>
    page
      .getByRole("dialog", { name })
      .evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const unreadable = await lookUp(page, "https://www.bilibili.com/video/BVbroken");
    await unreadable.getByText("Other ways to get the file").click();
    await unreadable.getByRole("button", { name: "Add another part" }).click();
    await expect(unreadable.getByRole("textbox", { name: "Title of part 2" })).toBeVisible();
    expect(await sideways(), `a video that can't be read, ${String(width)} wide`).toBe(false);
    expect(await dialogSideways("Add from Bilibili")).toBe(false);
    await unreadable.getByRole("button", { name: "Cancel" }).click();

    const read = await lookUp(page, "https://www.bilibili.com/video/BV17x411w7KC");
    await expect(read.getByRole("textbox", { name: "Title of part 3" })).toBeVisible();
    expect(await sideways(), `a video that was read, ${String(width)} wide`).toBe(false);
    expect(await dialogSideways("Add from Bilibili")).toBe(false);
    await read.getByRole("button", { name: "Cancel" }).click();
  }

  const read = await lookUp(page, "https://www.bilibili.com/video/BV17x411w7KC");
  await read.getByRole("button", { name: "Add 3 songs" }).click();
  await expect(page.getByText("Added 3 songs. They are downloading.")).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "More actions for Mixtape 1" }).click();
    await page.getByRole("menuitem", { name: "Add the file yourself…" }).click();
    const adding = page.getByRole("dialog", { name: "Add the file for “Mixtape 1”" });
    await expect(adding.getByText("yt-dlp --proxy").first()).toBeVisible();
    expect(await sideways(), `adding a file, ${String(width)} wide`).toBe(false);
    expect(await dialogSideways("Add the file for “Mixtape 1”")).toBe(false);
    await adding.getByRole("button", { name: "Cancel" }).click();
  }
});
