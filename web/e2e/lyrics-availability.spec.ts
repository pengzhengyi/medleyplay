/** @file Lyrics badges decorate small kind indicators, never artwork, on synthetic entries. */

import { expect, test, type Locator } from "@playwright/test";

import type { Lyrics, Track } from "../src/api";

async function expectIndicatorBadge(badge: Locator) {
  await expect(badge).toBeVisible();
  const geometry = await badge.evaluate((mark) => {
    const badge = mark.getBoundingClientRect();
    const anchor = mark.parentElement;
    const indicator = anchor?.getBoundingClientRect();
    return {
      kindIndicator: anchor?.matches(".kind-mark, .playing-kind"),
      artwork: mark.closest(".cover") !== null,
      compact: indicator !== undefined && indicator.width <= 32 && indicator.height <= 32,
      superscript:
        indicator !== undefined &&
        badge.top < indicator.top &&
        badge.left > indicator.left &&
        badge.right > indicator.right,
      pointerEvents: getComputedStyle(mark).pointerEvents,
      focusable: mark.hasAttribute("tabindex"),
    };
  });
  expect(geometry).toEqual({
    kindIndicator: true,
    artwork: false,
    compact: true,
    superscript: true,
    pointerEvents: "none",
    focusable: false,
  });
  const glyph = await badge.evaluate((mark) => {
    const svg = mark.querySelector("svg");
    if (svg === null) throw new Error("The quotation SVG is missing");
    const style = getComputedStyle(svg);
    const color = style.color;
    const size = Number.parseFloat(style.fontSize);
    const palette = document.createElement("span");
    palette.style.color = "var(--accent-ink)";
    mark.append(palette);
    const ink = getComputedStyle(palette).color;
    palette.remove();
    return { size, color, ink };
  });
  expect(glyph.size).toBeCloseTo(7.2);
  expect(glyph.color).toBe(glyph.ink);
  const indicator = badge.locator("..");
  const accessible = await indicator.ariaSnapshot();
  expect(accessible).not.toContain("\n  - img");
  await expect(badge).toHaveAttribute("aria-hidden", "true");
}

for (const width of [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`lyrics badges stay below sticky headings at ${String(width)}px in ${colorScheme}`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const response = await request.get("/api/tracks");
      expect(response.ok()).toBe(true);
      const catalog = (await response.json()) as Track[];
      const source = catalog[0];
      expect(source).toBeDefined();
      if (source === undefined) return;
      const tracks = Array.from({ length: 80 }, (_, index): Track => ({
        ...source,
        id: index + 90000,
        title: `Layer song ${String(index).padStart(3, "0")}`,
        artist: "Layer artist",
        artists: ["Layer artist"],
        album: "",
        album_artist: "",
        kind: "song",
        kind_reason: "named",
        split: false,
        segment_of: null,
        cover: null,
        has_lyrics: true,
      }));
      await page.route("**/*", (route) =>
        route.request().method() === "GET" &&
        new URL(route.request().url()).origin === new URL(baseURL ?? "").origin
          ? route.continue()
          : route.abort(),
      );
      await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
      await page.route("**/api/events?*", (route) =>
        route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" }),
      );
      await page.goto("/#/library");
      const row = page.getByRole("row").filter({
        has: page.getByRole("button", { name: "Layer song 000", exact: true }),
      });
      const badge = row.locator(".lyrics-badge");
      await expectIndicatorBadge(badge);

      for (const selector of [".tracks thead th", ".top"]) {
        await badge.evaluate((mark, layerSelector) => {
          const layer = document.querySelector(layerSelector);
          if (layer === null) throw new Error("Sticky layer missing");
          const box = layer.getBoundingClientRect();
          const badge = mark.getBoundingClientRect();
          const stickyTop = Number.parseFloat(getComputedStyle(layer).top);
          window.scrollBy(0, badge.top + badge.height / 2 - stickyTop - box.height / 2);
        }, selector);
        await expect
          .poll(async () =>
            badge.evaluate((mark, layerSelector) => {
              const box = mark.getBoundingClientRect();
              const previous = mark.style.pointerEvents;
              mark.style.pointerEvents = "auto";
              const layers = document.elementsFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              mark.style.pointerEvents = previous;
              const heading = layers.findIndex((element) => element.matches(layerSelector));
              const notation = layers.indexOf(mark);
              return { headingPresent: heading >= 0, badgeBeneath: notation > heading };
            }, selector),
          )
          .toEqual({ headingPresent: true, badgeBeneath: true });
      }
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await expectIndicatorBadge(badge);
    });

    test(`lyrics badges anchor to small indicators at ${String(width)}px in ${colorScheme}`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const response = await request.get("/api/tracks");
      expect(response.ok()).toBe(true);
      const catalog = (await response.json()) as Track[];
      expect(catalog.length).toBeGreaterThanOrEqual(3);
      const tracks = catalog.slice(0, 3).map((track, index): Track => ({
        ...track,
        title: ["First light", "Last train", "Complete song"][index] ?? "",
        artist: "Badge artist",
        artists: ["Badge artist"],
        album_artist: "Badge artist",
        album: index < 2 ? "Partial album" : "Complete album",
        split: false,
        segment_of: null,
        kind: "song",
        kind_reason: "named",
        cover: index === 0 ? "badge-image" : null,
        has_lyrics: index !== 1,
      }));
      await page.route("**/*", (route) =>
        route.request().method() === "GET" &&
        new URL(route.request().url()).origin === new URL(baseURL ?? "").origin
          ? route.continue()
          : route.abort(),
      );
      await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
      await page.route("**/api/events?*", (route) =>
        route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" }),
      );
      await page.route("**/api/covers/badge-image*", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#6b4ca5"/></svg>',
        }),
      );
      await page.addInitScript(() => {
        localStorage.setItem("medleyplay.language", "en");
      });
      await page.goto("/#/library");
      const first = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: "First light", exact: true }) });
      const absent = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: "Last train", exact: true }) });
      const badge = first.locator(".kind-mark .lyrics-badge");
      await expectIndicatorBadge(badge);
      await expect(first.locator(".lyrics-badge")).toHaveCount(1);
      await expect(absent.locator(".lyrics-badge")).toHaveCount(0);
      await expect(first.locator(".cover img")).toBeVisible();
      await expect(first.locator(".cover .lyrics-badge")).toHaveCount(0);

      await page.goto("/#/albums");
      const complete = page
        .getByRole("link")
        .filter({ has: page.getByText("Complete album", { exact: true }) });
      const partial = page
        .getByRole("link")
        .filter({ has: page.getByText("Partial album", { exact: true }) });
      await expectIndicatorBadge(complete.locator(".group-name .lyrics-badge"));
      await expect(complete.locator(".cover .lyrics-badge")).toHaveCount(0);
      await expect(partial.locator(".lyrics-badge")).toHaveCount(0);
      await complete.click();
      const about = page.getByRole("region", { name: "About the album" });
      await expectIndicatorBadge(page.locator(".album-heading .picture-title .lyrics-badge"));
      await expect(about.locator(".lyrics-badge")).toHaveCount(0);
      await about.hover();
      const replace = about.getByRole("button", { name: "Add a cover…", exact: true });
      await expect(replace).toBeVisible();
      await replace.click();
      await expect(page.getByRole("dialog", { name: "Add a cover" })).toBeVisible();
    });
  }
}

for (const shape of ["song", "group", "file"] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`Now Playing keeps ${shape} lyrics badges visible when phone lyrics replace the cover in ${colorScheme}`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const response = await request.get("/api/tracks");
      expect(response.ok()).toBe(true);
      const catalog = (await response.json()) as Track[];
      const source = catalog[0];
      expect(source).toBeDefined();
      if (source === undefined) return;
      const file: Track = {
        ...source,
        title: "Whole file",
        artist: "Badge artist",
        artists: ["Badge artist"],
        album_artist: "Badge artist",
        album: "Badge album",
        kind: "album",
        kind_reason: "split",
        split: true,
        segment_of: null,
        has_lyrics: true,
        availability: "ok",
        duration_ms: 374_000,
        cover: null,
      };
      const first: Track = {
        ...file,
        id: 90001,
        title: "Opening song",
        album: shape === "song" ? "" : file.album,
        kind: "song",
        kind_reason: "named",
        split: false,
        segment_of: shape === "file" ? file.id : null,
        duration_ms: 187_000,
        track_number: 1,
      };
      const last: Track = { ...first, id: 90002, title: "Closing song", track_number: 2 };
      const tracks =
        shape === "file" ? [file, first, last] : shape === "group" ? [first, last] : [first];
      await page.route("**/*", (route) =>
        route.request().method() === "GET" &&
        new URL(route.request().url()).origin === new URL(baseURL ?? "").origin
          ? route.continue()
          : route.abort(),
      );
      await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
      await page.route("**/api/events?*", (route) =>
        route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" }),
      );
      await page.route("**/api/tracks/*/playback", (route) =>
        route.fulfill({
          json: {
            state: "ready",
            source_id: 1,
            audio_url: "/api/badge-audio",
            media_type: "audio/wav",
          },
        }),
      );
      await page.route("**/api/badge-audio", (route) => route.fulfill({ status: 204 }));
      const lyrics: Lyrics = {
        origin: "household",
        synced: false,
        instrumental: false,
        text: "Words to sing",
        plain: "Words to sing",
        lines: [],
        found_at: "2026-11-26T12:00:00Z",
      };
      await page.route("**/api/tracks/*/lyrics", (route) => route.fulfill({ json: lyrics }));
      await page.addInitScript(() => {
        localStorage.setItem("medleyplay.language", "en");
        localStorage.removeItem("medleyplay.lyrics");
        HTMLMediaElement.prototype.play = () => Promise.resolve();
        HTMLMediaElement.prototype.pause = () => undefined;
      });
      await page.goto(shape === "group" ? "/#/albums" : "/#/library");
      await page
        .getByRole("button", {
          name:
            shape === "group" ? "Play every album" : shape === "file" ? file.title : first.title,
          exact: true,
        })
        .click();
      const player = page.getByRole("region", { name: "Player" });
      if (shape !== "song") {
        await expectIndicatorBadge(player.locator(".names .kind-mark .lyrics-badge"));
      }
      await expectIndicatorBadge(player.locator(".playing-kind .lyrics-badge"));
      await expect(player.locator(".cover .lyrics-badge")).toHaveCount(0);
      if (shape === "group") {
        await player.getByRole("button", { name: "Up next", exact: true }).click();
        const queue = page.getByRole("region", { name: "Up next", exact: true });
        await expectIndicatorBadge(queue.locator(".kind-mark .lyrics-badge").first());
        await expect(queue.locator(".cover .lyrics-badge")).toHaveCount(0);
        await player.getByRole("button", { name: "Up next", exact: true }).click();
      }
      await page
        .getByRole("region", { name: "Player" })
        .getByRole("button", { name: "Open Now Playing" })
        .click();
      const now = page.getByRole("dialog", { name: "Now Playing" });
      const art = now.locator(".np-art");
      const songBadge = now.locator(".np-song .lyrics-badge");
      const albumBadge = now.locator(".np-album .lyrics-badge");
      await expect(art).toBeHidden();
      await expectIndicatorBadge(songBadge);
      await expect(songBadge.locator("..")).toHaveAttribute("aria-label", /Lyrics available/);
      if (shape !== "song") {
        await expectIndicatorBadge(albumBadge);
        await expect(albumBadge.locator("..")).toHaveAttribute(
          "aria-label",
          /All songs have lyrics/,
        );
      }
      await expect(now.locator(".lyrics-badge:visible")).toHaveCount(shape === "song" ? 1 : 2);

      await now.getByRole("button", { name: "Lyrics", exact: true }).click();

      await expect(art).toBeVisible();
      await expect(art.locator(".lyrics-badge")).toHaveCount(0);
      await expectIndicatorBadge(songBadge);
      if (shape !== "song") await expectIndicatorBadge(albumBadge);
      await expect(now.locator(".lyrics-badge:visible")).toHaveCount(shape === "song" ? 1 : 2);

      await now.getByRole("button", { name: "Lyrics", exact: true }).click();
      await page.setViewportSize({ width: 1280, height: 900 });

      await expect(art).toBeVisible();
      await expectIndicatorBadge(songBadge);
      if (shape !== "song") await expectIndicatorBadge(albumBadge);
      await expect(art.locator(".lyrics-badge")).toHaveCount(0);
      await expect(now.locator(".lyrics-badge:visible")).toHaveCount(shape === "song" ? 1 : 2);
    });
  }
}
