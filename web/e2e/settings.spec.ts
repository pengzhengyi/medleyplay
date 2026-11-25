import assert from "node:assert/strict";

import { expect, test } from "@playwright/test";

test("Settings aligns its heading, section bar, and cards in a wider centered column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/#/settings");
  const main = page.getByRole("main");
  const heading = main.getByRole("heading", { name: "Settings", exact: true });
  const sections = main.getByRole("navigation", { name: "Settings sections" });
  const appearance = main.getByRole("region", { name: "Appearance" });
  await expect(appearance).toBeVisible();

  const [pane, card, bar, title] = await Promise.all([
    main.boundingBox(),
    appearance.boundingBox(),
    sections.boundingBox(),
    heading.boundingBox(),
  ]);
  assert(pane && card && bar && title);

  expect(card.width).toBeGreaterThan(pane.width * 0.8);
  expect(card.x + card.width / 2).toBeCloseTo(pane.x + pane.width / 2, 0);
  expect(bar.x).toBeCloseTo(card.x, 0);
  expect(bar.width).toBeCloseTo(card.width, 0);
  expect(title.x).toBeCloseTo(card.x, 0);
});

test("collapsing and expanding the view rail leaves Settings in place", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/#/settings");
  const main = page.getByRole("main");
  const appearance = main.getByRole("region", { name: "Appearance" });
  const toggle = page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: "Show the views' names" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const expanded = await appearance.boundingBox();
  assert(expanded);

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const collapsed = await appearance.boundingBox();
  assert(collapsed);
  expect(collapsed.x).toBeCloseTo(expanded.x, 0);
  expect(collapsed.width).toBeCloseTo(expanded.width, 0);

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const restored = await appearance.boundingBox();
  assert(restored);
  expect(restored.x).toBeCloseTo(expanded.x, 0);
  expect(restored.width).toBeCloseTo(expanded.width, 0);
});

test("the Settings section bar stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const storage = page.getByRole("region", { name: "Downloads and storage" });
  await sections.getByRole("button", { name: "Fold all" }).click();

  await sections.getByRole("button", { name: "Go to Downloads and storage" }).click();

  const heading = storage.getByRole("button", { name: "Downloads and storage" });
  await expect(heading).toBeFocused();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      heading.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
        );
      }),
    )
    .toBe(true);
  const [pane, card] = await Promise.all([
    page.getByRole("main").boundingBox(),
    storage.boundingBox(),
  ]);
  assert(pane && card);
  expect(card.x).toBeGreaterThanOrEqual(pane.x);
  expect(card.x + card.width).toBeLessThanOrEqual(pane.x + pane.width);
});

test("a storage limit an admin types saves on its own, and the server keeps it", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const storage = page.getByRole("region", { name: "Downloads and storage" });
  const size = storage.getByRole("spinbutton", { name: "Limit in GB" });

  await page.getByRole("radio", { name: /Up to/ }).check();
  await size.fill("5");
  await size.blur();
  await expect(storage.getByText("Saved.")).toBeVisible();
  await page.reload();

  await expect(size).toHaveValue("5");
  await expect(page.getByText(/of 5 GB used/)).toBeVisible();
  // Put the limit back as the other tests expect it.
  await page.getByRole("radio", { name: "No limit" }).check();
  await expect(storage.getByText("Saved.")).toBeVisible();
});

test("the theme chosen in Settings is the one the header shows", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  const settings = page.getByRole("main");

  await settings.getByRole("radio", { name: "Dark" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("banner").getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await settings.getByRole("radio", { name: "Match the system" }).click();
});
