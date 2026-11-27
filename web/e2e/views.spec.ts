// cspell:ignore charl
import { type Page, expect, test } from "@playwright/test";

import type { Features, Mode, Track, WaitingDevice } from "../src/api";

const nav = (page: Page) => page.getByRole("navigation", { name: "Views" });

for (const width of [320, 390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    const scenarios = [
      { online: true, waitingCount: 0 },
      { online: false, waitingCount: 0 },
      ...(width < 1280
        ? [
            { online: true, waitingCount: 1 },
            { online: false, waitingCount: 12 },
          ]
        : []),
    ];
    for (const { online, waitingCount } of scenarios) {
      test(`the GitHub header link stays at the first row's right edge at ${String(width)}px in ${colorScheme}, ${online ? "online" : "offline"}, ${String(waitingCount)} waiting`, async ({
        page,
        baseURL,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.route("**/*", (route) => {
          const request = route.request();
          return request.method() === "GET" &&
            new URL(request.url()).origin === new URL(baseURL ?? "").origin
            ? route.continue()
            : route.abort();
        });
        const featuresResponse = await page.request.get("/api/features");
        expect(featuresResponse.ok()).toBe(true);
        const features = (await featuresResponse.json()) as Features;
        await page.route("**/api/features", (route) =>
          route.fulfill({
            json: {
              ...features,
              providers: { ...features.providers, source_resolver: ["bilibili"] },
            },
          }),
        );
        const response = await page.request.get("/api/mode");
        expect(response.ok()).toBe(true);
        const mode = (await response.json()) as Mode;
        const shownMode = {
          ...mode,
          online,
          setting: "auto",
          reason: online ? "online" : "unreachable",
        };
        await page.route("**/api/mode", (route) =>
          route.fulfill({
            json: shownMode,
          }),
        );
        const waiting: WaitingDevice[] = Array.from({ length: waitingCount }, (_, index) => ({
          id: String(index),
          label: "Safari on iPhone",
          address: "192.0.2.1",
          code: "4821",
          since: "2026-11-07T18:00:00Z",
        }));
        await page.route("**/api/events?*", (route) =>
          route.fulfill({
            contentType: "text/event-stream",
            body: `event: ready\ndata: {}\n\nevent: mode\ndata: ${JSON.stringify(shownMode)}\n\nevent: devices\ndata: ${JSON.stringify({ waiting })}\n\n`,
          }),
        );
        const chinese = !online && waitingCount > 0 && colorScheme === "dark";
        await page.addInitScript(
          (language) => {
            localStorage.setItem("medleyplay.language", language);
          },
          chinese ? "zh-Hans" : "en",
        );
        await page.goto("/");
        const github = page.getByRole("link", {
          name: chinese
            ? "在 GitHub 上查看 medleyplay（在新标签页中打开）"
            : "View medleyplay on GitHub (opens in a new tab)",
        });
        await expect(github).toBeVisible();
        await expect(page.getByRole("link", { name: "medleyplay", exact: true })).toBeVisible();
        if (!online) {
          await expect(page.locator(".mode-note-link")).toBeVisible();
        }
        if (waitingCount > 0) {
          await expect(
            page.getByRole("button", {
              name:
                waitingCount === 1 ? "1 device waiting" : `${String(waitingCount)} devices waiting`,
            }),
          ).toBeVisible();
        }
        if (chinese) {
          // A failed device answer renders this sibling; inserting it avoids answering a device.
          await page.locator(".devices-waiting").evaluate((button) => {
            const failure = document.createElement("span");
            failure.className = "hint";
            failure.setAttribute("role", "alert");
            failure.textContent =
              "无法允许此设备，因为它已停止等待批准。请让设备重新连接，然后再试一次。";
            button.after(failure);
          });
          await expect(page.getByRole("alert")).toBeVisible();
        }

        const scope = page.getByRole("radiogroup", { name: "Search in" });
        const search = page.getByRole("combobox", { name: "Search" });
        for (const name of ["Library", "Bilibili"]) {
          const radio = scope.getByRole("radio", { name, exact: true });
          await radio.locator("..").click();
          await expect(radio).toBeChecked();
          await expect(radio).toBeFocused();
          await page.keyboard.press("Tab");
          await expect(search).toBeFocused();
          await search.fill(name === "Library" ? "layout" : "BV1Xx41117Tz");

          const scopeBox = await scope.boundingBox();
          const fieldBox = await page.locator(".search-field").boundingBox();
          expect(scopeBox).not.toBeNull();
          expect(fieldBox).not.toBeNull();
          if (scopeBox === null || fieldBox === null) throw new Error("Search is not visible.");
          expect(scopeBox.x + scopeBox.width).toBeLessThanOrEqual(fieldBox.x);
          expect(scopeBox.y + scopeBox.height / 2).toBeCloseTo(fieldBox.y + fieldBox.height / 2, 0);
          expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(width);

          if (name === "Library") {
            await page.getByRole("button", { name: "Clear search" }).click();
            await expect(search).toHaveValue("");
            await expect(search).toBeFocused();
          } else {
            await expect(search).toHaveValue("BV1Xx41117Tz");
          }
        }

        const layout = await page.locator(".top").evaluate((header) => {
          const box = header.getBoundingClientRect();
          const brand = header.querySelector("h1")?.getBoundingClientRect();
          const link = header.querySelector('a[href="https://github.com/pengzhengyi/medleyplay"]');
          const github = link?.getBoundingClientRect();
          const shortcuts = header.querySelector(".keys-button")?.getBoundingClientRect();
          const offline = header.querySelector(".mode-note")?.getBoundingClientRect();
          const devices = header.querySelector(".devices-waiting")?.getBoundingClientRect();
          const failure = header.querySelector('[role="alert"]')?.getBoundingClientRect();
          return {
            right: box.right - parseFloat(getComputedStyle(header).paddingRight),
            brandMiddle: brand && brand.y + brand.height / 2,
            githubMiddle: github && github.y + github.height / 2,
            githubLeft: github?.left,
            githubRight: github?.right,
            githubBottom: github?.bottom,
            offlineTop: offline?.top,
            devicesTop: devices?.top,
            failureTop: failure?.top,
            failureBottom: failure?.bottom,
            headerBottom: box.bottom,
            shortcutsRight: shortcuts?.right,
            fits: document.documentElement.scrollWidth <= window.innerWidth,
          };
        });

        expect(layout.githubMiddle).toBeCloseTo(layout.brandMiddle ?? 0, 0);
        expect(layout.githubRight).toBeCloseTo(layout.right, 0);
        expect(layout.fits).toBe(true);
        if (width === 1280) {
          expect(layout.githubLeft).toBeGreaterThan(layout.shortcutsRight ?? width);
        } else if (!online) {
          expect(layout.offlineTop).toBeGreaterThan(layout.githubBottom ?? 900);
        }
        if (waitingCount > 0) {
          expect(layout.devicesTop).toBeGreaterThan(layout.githubBottom ?? 900);
        }
        if (chinese) {
          expect(layout.failureTop).toBeGreaterThan(layout.githubBottom ?? 900);
          expect(layout.failureBottom).toBeLessThan(layout.headerBottom);
        }

        await github.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");

        await expect(github).toBeFocused();
        await expect(github).toHaveCSS("outline-style", "solid");
        await expect(github).toHaveCSS("outline-width", "2px");
      });
    }
  }
}

/** Give Alpha two separate credits and an album on the test server's read-only track response. */
async function giveAlphaCredits(page: Page, artists: readonly string[] = ["Adele", "Sia"]) {
  await page.route("**/api/tracks", async (route) => {
    const response = await route.fetch();
    const tracks = (await response.json()) as Track[];
    await route.fulfill({
      response,
      json: tracks.map((track) =>
        track.title === "Alpha"
          ? {
              ...track,
              artist: artists.join(", "),
              artists,
              artist_ids: [],
              album: "Duet",
              album_artist: "",
            }
          : track,
      ),
    });
  });
}

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

for (const width of [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`search clear keyboard focus stays inside the field at ${String(width)}px in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto("/");
      const search = page.getByRole("combobox", { name: "Search" });
      await search.fill("unmatched search");
      const clear = page.getByRole("button", { name: "Clear search" });

      await page.keyboard.press("Tab");

      await expect(clear).toBeFocused();
      const focus = await clear.evaluate((button) => {
        const style = getComputedStyle(button);
        const bounds = button.getBoundingClientRect();
        const field = button.closest(".search-field")?.getBoundingClientRect();
        if (field === undefined) throw new Error("Search field missing");
        const outset = Math.max(
          0,
          Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset),
        );
        return {
          visible: button.matches(":focus-visible") && style.outlineStyle === "solid",
          width: Number.parseFloat(style.outlineWidth),
          inside:
            bounds.top - outset >= field.top &&
            bounds.bottom + outset <= field.bottom &&
            bounds.left - outset >= field.left &&
            bounds.right + outset <= field.right,
        };
      });
      expect(focus.visible).toBe(true);
      expect(focus.width).toBeGreaterThanOrEqual(2);
      expect(focus.inside).toBe(true);

      await page.keyboard.press("Space");
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();

      await search.fill("unmatched search");
      await search.click();
      const resting = await clear.evaluate((button) => getComputedStyle(button).backgroundColor);
      await clear.hover();
      await expect(clear).toHaveCSS("outline-style", "none");
      await expect(clear).not.toHaveCSS("background-color", resting);
      await clear.click();
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
    });
  }
}

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

test("the keyboard reaches the artist and album links without playing the song", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await giveAlphaCredits(page);
  await page.goto("/");

  const row = page.getByRole("row", { name: /Alpha/u });
  await row.getByRole("button", { name: "Alpha", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(row.getByRole("link", { name: "Adele" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Adele", exact: true })).toBeVisible();
  await expect(page.getByText("Nothing playing")).toBeVisible();
  await page.goBack();

  await row.getByRole("button", { name: "Alpha", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(row.getByRole("link", { name: "Sia" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.getByRole("link", { name: "Duet" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Duet", exact: true })).toBeVisible();
  await expect(page.getByText("Nothing playing")).toBeVisible();
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

test("closing a linked cover editor leaves the artwork without an outline and the cover controls reachable", async ({
  page,
}) => {
  await giveAlphaCredits(page);
  await page.goto("/#/album?artist=Adele%2C+Sia&name=Duet&edit=cover");
  const editor = page.getByRole("dialog", { name: /^(Add a|Replace the) cover$/u });
  await expect(editor).toBeVisible();
  const artwork = page.getByRole("region", { name: "About the album" });

  await page.keyboard.press("Escape");

  await expect(editor).toBeHidden();
  await expect(artwork).toBeFocused();
  await expect(artwork).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Tab");
  const coverControl = artwork
    .getByRole("link", { name: "Save the image" })
    .or(artwork.getByRole("button", { name: "Add a cover…" }));
  await expect(coverControl).toBeFocused();
  await expect(coverControl).toHaveCSS("outline-style", "solid");
});

test("the queue shortcut focuses its selected tab rather than outlining the whole panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const queue = page.getByRole("region", { name: "Up next" });
  const history = queue.getByRole("tab", { name: "History" });
  await expect(queue.getByRole("tab", { name: "Up next" })).toBeVisible();
  await history.click();
  await page.getByRole("heading", { name: "Library", exact: true }).click();

  await page.keyboard.press("q");

  await expect(history).toBeFocused();
  await expect(history).toHaveCSS("outline-style", "solid");
  await expect(queue).not.toBeFocused();
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

  test("artist subtitles have one link per credit even with Album artist enabled", async ({
    page,
  }) => {
    const first = "The Long Orchestra with Every Instrument Performing Live Across the Entire City";
    await giveAlphaCredits(page, [first, "Sia"]);
    await page.addInitScript(() => {
      localStorage.setItem(
        "medleyplay.columns.v1",
        JSON.stringify({ visibility: { album_artist: true }, sizing: {} }),
      );
    });
    await page.goto("/");

    const row = page.getByRole("row", { name: /Alpha/u });
    await expect(row.getByRole("link")).toHaveText([first, "Sia"]);
    const guest = row.getByRole("link", { name: "Sia" });
    expect(
      await guest.evaluate((anchor) => {
        const subtitle = anchor.closest(".subtitle");
        return (
          subtitle !== null &&
          anchor.getBoundingClientRect().right <= subtitle.getBoundingClientRect().right
        );
      }),
    ).toBe(true);

    await guest.tap();

    await expect(page.getByRole("heading", { name: "Sia", exact: true })).toBeVisible();
    await expect(page.getByText("Nothing playing")).toBeVisible();
    await page.goBack();
    await expect(row.getByRole("link")).toHaveText([first, "Sia"]);
  });

  test("the views are a tab bar, and the queue opens from the player", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    const queue = page.getByRole("region", { name: "Up next" });
    await expect(queue).toBeHidden();

    const toggle = page.getByRole("button", { name: "Up next", exact: true });
    await toggle.click();

    await expect(queue.getByRole("listitem")).toHaveText([/Bravo/, /Charlie/, /Delta/]);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
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

/**
 * Intercept the catalog with 120 albums and 120 artists (118 unique plus two namesakes
 * named Zoe at the end of the alphabet, carrying `on <Album>` metadata, and favorites on
 * the first artist and album) so full gallery views extend far past one screen.
 */
async function serveLargeGallery(page: Page) {
  const tracks: Track[] = Array.from({ length: 120 }, (_, index) => {
    const number = index + 1;
    const padded = String(number).padStart(3, "0");
    const namesake = number === 119 ? "a" : number === 120 ? "b" : null;
    const artist = namesake === null ? `Artist ${padded}` : "Zoe";
    const artistId = namesake === null ? `artist-${padded}` : `artist-zoe-${namesake}`;
    const album =
      namesake === "a" ? "Zoe First" : namesake === "b" ? "Zoe Second" : `Album ${padded}`;
    return {
      id: number,
      title: `Song ${padded}`,
      artist,
      artists: [artist],
      artist_ids: [artistId],
      album,
      album_artist: "",
      year: 2024,
      genre: "Pop",
      duration_ms: 180_000,
      added_at: "2026-10-01T12:00:00Z",
      favorite: false,
      rating: null,
      play_count: 0,
      last_played_at: null,
      availability: "ok",
      downloaded: false,
      download_failed: false,
      download_failure_job_id: null,
      track_number: 1,
      disc_number: 1,
      site: null,
      video: null,
      segment_of: null,
      split: false,
      kind: "song",
      kind_reason: "named",
      has_lyrics: false,
      cover: null,
      community: null,
      album_rating: null,
    };
  });
  await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
  await page.route("**/api/artist-names", (route) =>
    route.fulfill({
      json: {
        names: [
          {
            name: "Zoe",
            tracks: 2,
            look_up: "no",
            artist_id: null,
            artist_ids: ["artist-zoe-a", "artist-zoe-b"],
            finding: false,
          },
        ],
        artists: [],
      },
    }),
  );
  await page.route("**/api/favorites", (route) =>
    route.fulfill({
      json: {
        artists: [{ id: "artist-001" }],
        albums: [{ artist: "Artist 001", name: "Album 001" }],
      },
    }),
  );
}

/** Check a descendant: the link's own box stays visible when its contents are skipped. */
async function cardContentRendered(link: ReturnType<Page["locator"]>): Promise<boolean> {
  return link.evaluate((anchor) => {
    const name = anchor.querySelector(".group-name");
    return name instanceof HTMLElement && name.checkVisibility({ contentVisibilityAuto: true });
  });
}

test("large album galleries skip offscreen cards while keeping all links reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await serveLargeGallery(page);

  await page.goto("/#/albums");
  const albumList = page.getByRole("list", { name: "Albums" });
  const albumLinks = albumList.getByRole("link");
  await expect(albumLinks).toHaveCount(120);

  const firstAlbum = albumLinks.first();
  const lastAlbum = albumLinks.last();
  await expect.poll(() => cardContentRendered(firstAlbum)).toBe(true);
  await expect.poll(() => cardContentRendered(lastAlbum)).toBe(false);

  const reservedAlbumHeight = await lastAlbum.evaluate(
    (anchor) => anchor.getBoundingClientRect().height,
  );
  await lastAlbum.scrollIntoViewIfNeeded();
  await expect.poll(() => cardContentRendered(lastAlbum)).toBe(true);
  const renderedAlbumHeight = await lastAlbum.evaluate(
    (anchor) => anchor.getBoundingClientRect().height,
  );
  expect(Math.abs(reservedAlbumHeight - renderedAlbumHeight)).toBeLessThanOrEqual(4);

  await lastAlbum.click();
  await expect(page.getByRole("heading", { name: "Zoe Second", exact: true })).toBeVisible();

  // The link's shadow and focus outline extend outside its list item.
  await page.goto("/#/albums");
  await expect(albumLinks).toHaveCount(120);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((chosen) => {
      document.documentElement.dataset.theme = chosen;
    }, theme);
    await firstAlbum.hover();
    const visual = await firstAlbum.evaluate((anchor) => {
      const item = anchor.parentElement;
      const itemStyle = item === null ? null : getComputedStyle(item);
      const linkStyle = getComputedStyle(anchor);
      return {
        itemContentVisibility: itemStyle?.contentVisibility ?? "",
        itemContain: itemStyle?.contain ?? "",
        hoverShadow: linkStyle.boxShadow,
      };
    });
    expect(visual.itemContentVisibility).toBe("visible");
    expect(visual.itemContain).not.toContain("paint");
    expect(visual.hoverShadow).not.toBe("none");

    await firstAlbum.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(firstAlbum).toBeFocused();
    await expect(firstAlbum).toHaveCSS("outline-style", "solid");
  }

  await expect.poll(() => cardContentRendered(lastAlbum)).toBe(false);
  await lastAlbum.focus();

  await expect(lastAlbum).toBeFocused();
  await expect.poll(() => cardContentRendered(lastAlbum)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Zoe Second", exact: true })).toBeVisible();
});

test("Artists keep their existing rendering and namesake links", async ({ page }) => {
  await serveLargeGallery(page);
  await page.goto("/#/artists");
  const artistList = page.getByRole("list", { name: "Artists" });
  const artistLinks = artistList.getByRole("link");
  await expect(artistLinks).toHaveCount(120);

  const lastArtist = artistLinks.last();
  await expect.poll(() => cardContentRendered(artistLinks.first())).toBe(true);
  await expect.poll(() => cardContentRendered(lastArtist)).toBe(true);
  await lastArtist.focus();
  await expect(lastArtist).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Zoe", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Song 120", exact: true })).toBeVisible();
});

test("search result galleries do not apply offscreen gallery skipping", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await serveLargeGallery(page);

  await page.goto("/#/search?q=Album");
  const foundAlbums = page.getByRole("region", { name: "Albums found" }).getByRole("link");
  await expect(foundAlbums).toHaveCount(118);
  await expect.poll(() => cardContentRendered(foundAlbums.last())).toBe(true);
});

test("large albums keep their layout when resized and text is enlarged", async ({ page }) => {
  await serveLargeGallery(page);
  await page.goto("/#/albums");
  const list = page.locator("ul.deferred-gallery");
  const links = list.getByRole("link");
  await expect(links).toHaveCount(120);

  for (const width of [1280, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const size of ["100%", "125%"]) {
      await page.evaluate((fontSize) => {
        document.documentElement.style.fontSize = fontSize;
      }, size);
      await expect.poll(() => cardContentRendered(links.last())).toBe(false);
      const layout = await list.evaluate((gallery) => {
        const measure = () => {
          const links = gallery.querySelectorAll("li > a");
          const first = links[0]?.getBoundingClientRect();
          const last = links[links.length - 1]?.getBoundingClientRect();
          return {
            height: gallery.getBoundingClientRect().height,
            first: first?.height ?? 0,
            last: last?.height ?? 0,
            fits: document.documentElement.scrollWidth <= window.innerWidth,
          };
        };
        const skipped = measure();
        gallery.classList.remove("deferred-gallery");
        const rendered = measure();
        gallery.classList.add("deferred-gallery");
        return { skipped, rendered };
      });

      expect(layout.skipped.fits).toBe(true);
      expect(layout.skipped.first).toBeCloseTo(layout.rendered.first, 1);
      expect(Math.abs(layout.skipped.last - layout.rendered.last)).toBeLessThan(0.1);
      expect(Math.abs(layout.skipped.height - layout.rendered.height)).toBeLessThan(4);
    }
  }
});

test.describe("large galleries on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("skip offscreen cards and match responsive card height", async ({ page }) => {
    await serveLargeGallery(page);
    await page.goto("/#/albums");

    const albumLinks = page.getByRole("list", { name: "Albums" }).getByRole("link");
    await expect(albumLinks).toHaveCount(120);

    const lastAlbum = albumLinks.last();
    await expect.poll(() => cardContentRendered(albumLinks.first())).toBe(true);
    await expect.poll(() => cardContentRendered(lastAlbum)).toBe(false);

    const reservedHeight = await lastAlbum.evaluate(
      (anchor) => anchor.getBoundingClientRect().height,
    );
    await lastAlbum.scrollIntoViewIfNeeded();
    await expect.poll(() => cardContentRendered(lastAlbum)).toBe(true);
    const renderedHeight = await lastAlbum.evaluate(
      (anchor) => anchor.getBoundingClientRect().height,
    );
    expect(Math.abs(reservedHeight - renderedHeight)).toBeLessThanOrEqual(4);

    await lastAlbum.click();
    await expect(page.getByRole("heading", { name: "Zoe Second", exact: true })).toBeVisible();
  });
});
