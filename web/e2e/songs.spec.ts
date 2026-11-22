import { type Page, expect, test } from "@playwright/test";

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
