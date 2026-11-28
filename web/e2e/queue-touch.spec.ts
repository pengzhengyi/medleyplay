import { setTimeout as wait } from "node:timers/promises";

import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";

import type { Track } from "../src/api";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function openQueue(page: Page, inDialog: boolean) {
  const player = page.getByRole("region", { name: "Player" });
  await page.getByRole("button", { name: "Alpha", exact: true }).tap();
  await player.getByRole("button", { name: "Pause", exact: true }).tap();
  if (inDialog) await player.getByRole("button", { name: "Open Now Playing" }).tap();
  const scope = inDialog ? page.getByRole("dialog", { name: "Now Playing" }) : page;
  const controls = inDialog ? scope : player;
  await controls.getByRole("button", { name: "Up next", exact: true }).tap();
  return scope.getByRole("region", { name: "Up next", exact: true });
}

async function touchOn(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Missing touch target.");
  const session = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  return {
    y,
    start: () =>
      session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }),
    move: async (by: number, from = 0, steps = 8) => {
      for (let step = 1; step <= steps; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: Math.round(y + from + (step * (by - from)) / steps) }],
        });
        await wait(17);
      }
    },
    finish: async (type: "touchEnd" | "touchCancel" = "touchEnd") => {
      await session.send("Input.dispatchTouchEvent", { type, touchPoints: [] });
      await session.detach();
    },
  };
}

const handlesOf = (queue: Locator) => queue.getByRole("button", { name: /^Reorder /u });
const orderOf = (queue: Locator) =>
  handlesOf(queue).evaluateAll((handles) =>
    handles.map((handle) => handle.getAttribute("aria-label")),
  );
const scrolled = (queue: Locator) => queue.evaluate((panel) => panel.scrollTop);

async function longQueue(page: Page, request: APIRequestContext, inDialog: boolean) {
  const response = await request.get("/api/tracks");
  const tracks = (await response.json()) as Track[];
  const sample = tracks.find((track) => track.title === "Alpha");
  if (!sample) throw new Error("Missing Alpha fixture.");
  const queueTracks = Array.from({ length: 24 }, (_, i) => ({
    ...sample,
    id: 10_000 + i,
    title: `Touch ${String(i + 1).padStart(2, "0")}`,
  }));
  await page.route("**/api/tracks", (route) => route.fulfill({ json: [sample, ...queueTracks] }));
  await page.goto("/");
  const queue = await openQueue(page, inDialog);
  await expect(handlesOf(queue)).toHaveCount(queueTracks.length);
  return queue;
}

for (const inDialog of [false, true]) {
  test(`taps move a song without playing it in ${inDialog ? "Now Playing" : "the player"}`, async ({
    browserName,
    page,
    request,
  }) => {
    const queue = await longQueue(page, request, inDialog);
    const before = await orderOf(queue);
    const more = queue.getByRole("button", { name: "Up next actions for Touch 04", exact: true });
    if (browserName === "chromium") {
      const swipe = await touchOn(page, more);
      const scrollBefore = await scrolled(queue);
      await swipe.start();
      await swipe.move(-100);
      await swipe.finish();
      await expect.poll(() => scrolled(queue)).toBeGreaterThan(scrollBefore);
      await expect(page.getByRole("menu")).toHaveCount(0);
      expect(await orderOf(queue)).toEqual(before);
    }

    await more.tap();
    const menu = page.getByRole("menu", { name: "Up next actions for Touch 04" });
    await expect(menu.getByRole("menuitem", { name: "Move to top" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(await orderOf(queue)).toEqual(before);

    await more.tap();
    await menu.getByRole("menuitem", { name: "Move to top" }).tap();
    await expect(handlesOf(queue).first()).toHaveAccessibleName("Reorder Touch 04");
    await expect(more).toBeFocused();
    await expect(page.locator("audio")).toHaveJSProperty("paused", true);
    await more.tap();
    await expect(menu.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    await menu.getByRole("menuitem", { name: "Move to end" }).tap();
    await expect(handlesOf(queue).last()).toHaveAccessibleName("Reorder Touch 04");
    await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  });

  test(`touch scrolls and deliberately reorders Up next in ${inDialog ? "Now Playing" : "the player"}`, async ({
    browserName,
    page,
    request,
  }) => {
    test.skip(browserName !== "chromium", "Sending a touch sequence requires Chromium CDP.");
    const queue = await longQueue(page, request, inDialog);
    const first = await orderOf(queue);
    const handle = queue.getByRole("button", { name: "Reorder Touch 04", exact: true });
    await handle.tap();
    expect(await orderOf(queue)).toEqual(first);

    const cancelled = await touchOn(page, handle);
    await cancelled.start();
    await expect(
      queue.locator(".dragging").getByRole("button", { name: "Reorder Touch 04" }),
    ).toBeVisible();
    await cancelled.move(-45);
    await cancelled.finish("touchCancel");
    await expect(queue.locator(".dragging")).toHaveCount(0);
    expect(await orderOf(queue)).toEqual(first);

    const destination = queue.getByRole("button", { name: "Reorder Touch 02", exact: true });
    const held = await touchOn(page, handle);
    const to = await destination.boundingBox();
    if (!to) throw new Error("Missing drop target.");
    const pageScroll = await page.evaluate(() => window.scrollY);
    await held.start();
    await expect(
      queue.locator(".dragging").getByRole("button", { name: "Reorder Touch 04" }),
    ).toBeVisible();
    await held.move(to.y + to.height / 2 - held.y);
    await held.finish();
    const reordered = [...first];
    reordered.splice(3, 1);
    reordered.splice(1, 0, "Reorder Touch 04");
    expect(await orderOf(queue)).toEqual(reordered);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
    await expect(page.locator("audio")).toHaveJSProperty("paused", true);

    const swipe = await touchOn(page, queue.getByRole("button", { name: "Reorder Touch 03" }));
    const before = await scrolled(queue);
    await swipe.start();
    await swipe.move(-32, 0, 1);
    // Pausing a scroll with the finger still down must not activate reordering.
    await wait(340);
    await swipe.move(-130, -32);
    await swipe.finish();
    await expect.poll(() => scrolled(queue)).toBeGreaterThan(before);
    expect(await orderOf(queue)).toEqual(reordered);
  });
}

test("a held touch can move a song past the first hidden row without scrolling the page", async ({
  browserName,
  page,
  request,
}) => {
  test.skip(browserName !== "chromium", "Sending a touch sequence requires Chromium CDP.");
  await page.emulateMedia({ colorScheme: "dark" });
  const queue = await longQueue(page, request, false);
  const handle = queue.getByRole("button", { name: "Reorder Touch 04", exact: true });
  const gesture = await touchOn(page, handle);
  const firstHidden = await queue.evaluate((panel) => {
    const bottom = panel.getBoundingClientRect().bottom;
    return [...panel.querySelectorAll(".handle")].findIndex(
      (row) => row.getBoundingClientRect().top >= bottom,
    );
  });
  expect(firstHidden).toBeGreaterThan(3);
  const panel = await queue.boundingBox();
  if (!panel) throw new Error("Missing queue bounds.");
  const before = await scrolled(queue);
  const pageScroll = await page.evaluate(() => window.scrollY);

  await gesture.start();
  await expect(
    queue.locator(".dragging").getByRole("button", { name: "Reorder Touch 04" }),
  ).toBeVisible();
  await gesture.move(panel.y + panel.height - 16 - gesture.y);
  await expect.poll(() => scrolled(queue)).toBeGreaterThan(before + 120);
  await gesture.finish();

  expect((await orderOf(queue)).indexOf("Reorder Touch 04")).toBeGreaterThanOrEqual(firstHidden);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
});
