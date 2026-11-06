import { type Page, expect, test } from "@playwright/test";

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
  await dialog.getByRole("button", { name: "Use these 2 songs" }).click();

  await expect(dialog.getByRole("textbox", { name: "Title of song 2" })).toHaveValue("Night Drive");
  await expect(dialog.getByRole("textbox", { name: "Artist of song 2" })).toHaveValue("Blue Room");
  await dialog.getByRole("button", { name: "Details" }).click();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeVisible();
});
