// cspell:ignore charl
import { type Page, expect, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Views" });

test("the device and account are read while the Library script loads", async ({ page }) => {
  let releaseScript: () => void = () => undefined;
  const scriptHeld = new Promise<void>((resolve) => {
    releaseScript = resolve;
  });
  await page.route("**/assets/*.js", async (route) => {
    await scriptHeld;
    await route.continue();
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(new URL(request.url()).pathname);
  });

  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect.poll(() => requests).toContain("/api/me");
    expect(requests).toContain("/api/device");
    expect(requests).not.toContain("/api/tracks");
  } finally {
    releaseScript();
  }

  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  expect(requests.filter((path) => path === "/api/device" || path === "/api/me")).toEqual([
    "/api/device",
    "/api/me",
  ]);
});

test("startup reads neither the account nor tracks on a device waiting for approval", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/device", (route) =>
    route.fulfill({ json: { presence: "waiting", label: "Guest", code: "0042" } }),
  );

  await page.goto("/");

  await expect(page.getByLabel("Code 0042")).toBeVisible();
  expect(requests).not.toContain("/api/me");
  expect(requests).not.toContain("/api/tracks");
});

test("a row previews its favorite action without marking the song as a favorite", async ({
  page,
}) => {
  await page.goto("/");
  const row = page
    .getByRole("row")
    .filter({ has: page.locator('button.heart[aria-pressed="false"]') })
    .first();
  const heart = row.locator("button.heart");
  await heart.waitFor();
  const accent = await heart.evaluate((button) => {
    const sample = document.createElement("span");
    sample.style.color = "var(--accent)";
    button.append(sample);
    const color = getComputedStyle(sample).color;
    sample.remove();
    return color;
  });

  const title = row.locator("button.title");
  await expect(heart).toHaveCSS("opacity", "0");
  await title.hover();

  await expect(heart).toHaveCSS("opacity", "1");
  await expect(heart).toHaveCSS("color", accent);
  await expect(heart).toHaveAttribute("aria-pressed", "false");

  await nav(page).hover();
  await expect(heart).toHaveCSS("opacity", "0");
  await title.focus();
  await expect(heart).toHaveCSS("opacity", "1");
  await expect(heart).toHaveCSS("color", accent);
});

test("the views follow the links, Back, and Forward", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();

  await nav(page).getByRole("link", { name: "Artists" }).click();
  // The test music has no tags, so its songs are by no one in particular.
  await page.getByRole("link", { name: /Unknown artist/ }).click();
  await expect(page.getByRole("heading", { name: "Unknown artist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delta", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Artists" })).toBeVisible();
  await page.goForward();

  await expect(page.getByRole("heading", { name: "Unknown artist" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Artists" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a view's link opens it again after a reload", async ({ page }) => {
  await page.goto("/#/playlists");
  await page
    .getByRole("link", { name: /Favorites/ })
    .first()
    .click();

  await page.reload();

  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
});

test("the search dropdown stays above the sticky Settings section bar", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

  await page.getByRole("combobox", { name: "Search" }).press("ArrowDown");

  const dropdown = page.getByRole("listbox", { name: "Search by" });
  await expect(dropdown).toBeVisible();
  await expect
    .poll(() =>
      dropdown.evaluate((panel) => {
        const bar = document.querySelector(".settings-toc");
        if (bar === null) return false;
        const menu = panel.getBoundingClientRect();
        const sections = bar.getBoundingClientRect();
        const left = Math.max(menu.left, sections.left);
        const top = Math.max(menu.top, sections.top);
        const right = Math.min(menu.right, sections.right);
        const bottom = Math.min(menu.bottom, sections.bottom);
        if (left >= right || top >= bottom) return false;
        return panel.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
      }),
    )
    .toBe(true);
});

test("searching finds songs as you type, and Back leaves the search in one step", async ({
  page,
}) => {
  await page.goto("/#/albums");

  await page.getByRole("combobox", { name: "Search" }).fill("charl");

  const found = page.getByRole("region", { name: "Songs found" });
  await expect(found.getByRole("button", { name: "Charlie", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search" }).fill("charlie");
  await expect(page.getByRole("heading", { name: "Results for “charlie”" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Albums" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the views are a tab bar, and the queue opens from the player", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    const queue = page.getByRole("region", { name: "Up next" });
    await expect(queue).toBeHidden();

    await page.getByRole("button", { name: "Up next" }).click();

    await expect(queue.getByRole("listitem")).toHaveText([/Bravo/, /Charlie/, /Delta/]);
    await expect(page.getByRole("button", { name: "Up next" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await nav(page).getByRole("link", { name: "Albums" }).click();
    await expect(page.getByRole("heading", { name: "Albums" })).toBeVisible();
  });
});

/** A PNG of one pixel: no larger than any thumbnail, so it is always served as it is. */
const ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("an album's tile asks for a thumbnail of its cover, and shows the original while there is none", async ({
  page,
}) => {
  const tracks = (await (await page.request.get("/api/tracks")).json()) as {
    id: number;
    title: string;
  }[];
  const bravo = tracks.find((each) => each.title === "Bravo")?.id;
  const uploaded = await page.request.put(`/api/tracks/${String(bravo)}/cover`, {
    data: ONE_PIXEL,
    headers: { "Content-Type": "image/png" },
  });
  expect(uploaded.ok()).toBe(true);
  try {
    await page.goto("/#/albums");

    const tile = page.locator(".cover-tile img").first();

    await expect(tile).toHaveAttribute("src", /\?size=medium&recipe=1$/u);
    await expect.poll(() => tile.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  } finally {
    await page.request.delete(`/api/tracks/${String(bravo)}/cover`);
  }
});

test("dragging a view to another place in the rail keeps it there after a reload, and a click still opens it", async ({
  page,
}) => {
  await page.goto("/");
  const links = nav(page).getByRole("link");
  await expect(links.first()).toHaveAccessibleName("Library");
  const radio = nav(page).getByRole("link", { name: "Radio" });
  const library = nav(page).getByRole("link", { name: "Library" });

  const from = await radio.boundingBox();
  const to = await library.boundingBox();
  if (from === null || to === null) {
    throw new Error("The rail isn't shown.");
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
  await page.mouse.up();
  await expect(links.first()).toHaveAccessibleName("Radio");
  await expect(page).not.toHaveURL(/#\/radio/);
  await page.reload();
  await expect(links.first()).toHaveAccessibleName("Radio");

  await radio.click();

  await expect(page).toHaveURL(/#\/radio/);
  await page.evaluate(() => {
    localStorage.removeItem("medleyplay.rail-order");
  });
});
