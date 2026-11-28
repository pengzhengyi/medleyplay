import { type Locator, expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 844 } });

async function expectTouchTarget(target: Locator) {
  await expect(target).toBeVisible();
  await target.tap({ trial: true });
  const hit = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const middle = element.ownerDocument.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return {
      label: element.getAttribute("aria-label") ?? element.textContent,
      width: box.width,
      height: box.height,
      reachable: element.contains(middle),
      covering:
        middle === null
          ? `outside the ${String(window.innerWidth)} × ${String(window.innerHeight)} viewport at ${String(box.x)}, ${String(box.y)}`
          : `${middle.tagName}.${middle.getAttribute("class") ?? ""}`,
    };
  });
  expect(hit.width, hit.label).toBeGreaterThanOrEqual(44);
  expect(hit.height, hit.label).toBeGreaterThanOrEqual(44);
  expect(hit.reachable, `${hit.label} is covered by ${hit.covering}`).toBe(true);
}

test("playback and seek targets remain distinct on a narrow phone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Alpha", exact: true }).tap();
  const player = page.getByRole("region", { name: "Player" });
  await player.getByRole("button", { name: "Pause", exact: true }).tap();
  await expect(player.getByRole("slider", { name: "Position" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );

  for (const name of ["Open Now Playing", "More actions for Alpha", "Previous", "Play", "Next"]) {
    await expectTouchTarget(player.getByRole("button", { name, exact: true }));
  }
  const position = player.getByRole("slider", { name: "Position" });
  await expectTouchTarget(position);
  const bar = await position.boundingBox();
  if (!bar) throw new Error("Missing seek bar.");
  await page.touchscreen.tap(bar.x + bar.width / 2, bar.y + 5);
  await expect(page.locator("audio")).toHaveJSProperty("currentTime", 30);
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);

  const queueToggle = player.getByRole("button", { name: "Up next", exact: true });
  await queueToggle.tap();
  const queue = page.getByRole("region", { name: "Up next", exact: true });
  await expect(queue).toBeVisible();
  const [panel, deck] = await Promise.all([queue.boundingBox(), player.boundingBox()]);
  if (!panel || !deck) throw new Error("Missing player or queue bounds.");
  expect(panel.y + panel.height).toBeLessThan(deck.y);
  await queueToggle.tap();

  await player.getByRole("button", { name: "Open Now Playing" }).tap();
  const dialog = page.getByRole("dialog", { name: "Now Playing" });
  await expectTouchTarget(dialog.getByRole("slider", { name: "Position" }));
  await expectTouchTarget(dialog.getByRole("button", { name: "Up next", exact: true }));
  await expectTouchTarget(dialog.getByRole("button", { name: "Close Now Playing" }));
  await dialog.getByRole("button", { name: "Close Now Playing" }).tap();
  await expect(dialog).toHaveCount(0);
});

test("touching Settings controls does not require scrolling the page sideways", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(page.getByText("Import ratings", { exact: true })).toBeVisible();
  await expectTouchTarget(sections.getByRole("button", { name: "Fold all" }));
  expect(await page.locator("html").evaluate((root) => root.scrollWidth)).toBe(320);

  await sections.getByRole("button", { name: "Fold all" }).tap();
  const appearance = page.getByRole("button", { name: "Appearance", exact: true });
  await expect(appearance).toHaveAttribute("aria-expanded", "false");
  await expectTouchTarget(appearance);
  await appearance.tap();
  await expect(appearance).toHaveAttribute("aria-expanded", "true");
});

test.describe("coarse pointer on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });

  test("opens row actions without hovering and sets a column width by touch", async ({ page }) => {
    await page.goto("/");
    const row = page.getByRole("row", { name: /\bAlpha\b/u });
    const more = row.getByRole("button", { name: "More actions for Alpha" });
    await expect(more).toHaveCSS("opacity", "1");
    await expectTouchTarget(more);
    await more.tap();
    await expect(page.getByRole("menuitem", { name: "Play next" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByText("Columns", { exact: true }).tap();
    const width = page.getByRole("spinbutton", { name: "Artist width in pixels" });
    await expectTouchTarget(width);
    await width.tap();
    await width.fill("135");
    await page.getByRole("checkbox", { name: "Artist", exact: true }).focus();
    const artist = page.getByRole("columnheader", { name: "Artist", exact: true });
    await expect(artist).toHaveCSS("width", "135px");
    await page.getByRole("button", { name: "Reset Artist width" }).tap();
    await expect(artist).not.toHaveCSS("width", "135px");
  });

  test.describe("a phone in landscape", () => {
    test.use({ viewport: { width: 844, height: 390 } });

    for (const [width, height] of [
      [844, 390],
      [844, 500],
      [1100, 390],
    ] as const) {
      test(`the Library and Now Playing controls stay reachable in landscape at ${String(width)} by ${String(height)}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        await page.getByRole("button", { name: "Alpha", exact: true }).tap();

        const player = page.getByRole("region", { name: "Player" });
        await expectTouchTarget(player.getByRole("button", { name: "Pause", exact: true }));
        await player.getByRole("button", { name: "Pause", exact: true }).tap();
        await player.getByRole("button", { name: "Open Now Playing" }).tap();
        const dialog = page.getByRole("dialog", { name: "Now Playing" });
        const queueToggle = dialog.getByRole("button", { name: "Up next", exact: true });
        for (const lyricsOn of [true, false]) {
          const lyrics = dialog.getByRole("button", { name: "Lyrics", exact: true });
          await expect(lyrics).toHaveAttribute("aria-pressed", String(lyricsOn));
          await expectTouchTarget(dialog.getByRole("button", { name: "Play", exact: true }));
          await expectTouchTarget(queueToggle);
          await queueToggle.tap();
          await expect(dialog.getByRole("region", { name: "Up next", exact: true })).toBeVisible();
          await queueToggle.tap();
          if (lyricsOn) await lyrics.tap();
        }
      });
    }
  });
});
