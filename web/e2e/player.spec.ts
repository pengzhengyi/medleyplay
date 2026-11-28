import { type Locator, type Page, expect as baseExpect, test } from "@playwright/test";

import type { Track } from "../src/api";

// Playback runs on the audio clock, which a busy machine slows; waits allow for that.
const expect = baseExpect.configure({ timeout: 15_000 });

/** The audio element's position and whether it is playing. */
async function audioState(page: Page) {
  return page.locator("audio").evaluate((audio: HTMLAudioElement) => ({
    playing: !audio.paused,
    position: audio.currentTime,
  }));
}

const player = (page: Page) => page.getByRole("region", { name: "Player" });
const upNext = (page: Page) => page.getByRole("region", { name: "Up next" }).getByRole("listitem");

async function play(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(player(page).getByText(title, { exact: true })).toBeVisible();
}

for (const [effect, animation, width] of [
  ["flow", "np-palette-glow", 1280],
  ["drift", "np-soft-pan", 390],
] as const) {
  test(`saved ${effect} plays lightweight cover motion and respects reduced motion`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const response = await request.get("/api/tracks");
    expect(response.ok()).toBe(true);
    const tracks = (await response.json()) as Track[];
    await page.route("**/api/tracks", (route) =>
      route.fulfill({
        json: tracks.map((track) =>
          track.title === "Alpha" ? { ...track, cover: "motion-fixture" } : track,
        ),
      }),
    );
    await page.route("**/api/covers/motion-fixture*", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#ec1c62"/><rect x="70" width="90" height="120" fill="#294ccc"/></svg>',
      }),
    );
    await page.addInitScript((choice) => {
      localStorage.setItem("medleyplay.dynamics", choice);
    }, effect);

    await page.goto("/");
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    await player(page).getByRole("button", { name: "Open Now Playing" }).click();
    const dialog = page.getByRole("dialog", { name: "Now Playing" });
    const layer = dialog.locator(".np-cover-motion-layer");
    await expect(layer).toHaveCSS("animation-name", animation);
    const backdrop = () =>
      layer.evaluate((element, choice) => {
        const style = getComputedStyle(element, choice === "drift" ? "::before" : null);
        return { image: style.backgroundImage, filter: style.filter };
      }, effect);
    const active = await backdrop();
    expect(active.image).not.toBe("none");
    if (effect === "drift") expect(active.filter).toBe("blur(40px)");
    await expect(dialog.locator("canvas")).toHaveCount(0);
    expect(
      await layer.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left <= 0 &&
          bounds.top <= 0 &&
          bounds.right >= window.innerWidth &&
          bounds.bottom >= window.innerHeight
        );
      }),
    ).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(layer).toHaveCSS("animation-name", "none");
    expect(await backdrop()).toEqual(active);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(layer).toHaveCount(0);
  });
}

test("choosing a Track plays it and queues the Tracks after it", async ({ page }) => {
  await play(page, "Alpha");

  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThan(0.5);
  expect((await audioState(page)).playing).toBe(true);
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);
  await expect(player(page).getByRole("button", { name: "Pause" })).toBeVisible();
});

const queueHeaderWords = {
  en: {
    next: "Up next",
    history: "History",
    fold: "Collapse all",
    timer: "Sleep timer",
    clear: "Clear Up next",
  },
  "zh-Hans": {
    next: "接下来播放",
    history: "历史",
    fold: "全部折叠",
    timer: "睡眠定时器",
    clear: "清空接下来播放的队列",
  },
};

for (const language of ["en", "zh-Hans"] as const) {
  test(`the Up next tabs and album queue controls fit on one line in ${language}`, async ({
    page,
    request,
  }) => {
    const words = queueHeaderWords[language];
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = await request.get("/api/tracks");
    expect(response.ok()).toBe(true);
    const [sample] = (await response.json()) as Track[];
    if (sample === undefined) throw new Error("The test library has no tracks.");
    const first: Track = { ...sample, availability: "ok" };
    const file: Track = { ...first, id: 90000, title: "Album file", kind: "album", split: true };
    const tracks: Track[] = [
      first,
      file,
      ...Array.from({ length: 45 }, (_, index) => ({
        ...first,
        id: 90001 + index,
        title: `Album song ${String(index + 1)}`,
        segment_of: file.id,
        track_number: index + 1,
      })),
    ];
    await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
    await page.route("**/api/tracks/*/playback", (route) =>
      route.fulfill({
        json: {
          state: "ready",
          source_id: 1,
          audio_url: "/api/queue-test-audio",
          media_type: "audio/wav",
        },
      }),
    );
    await page.route("**/api/queue-test-audio", (route) => route.fulfill({ status: 204 }));
    await page.addInitScript((choice) => {
      localStorage.setItem("medleyplay.language", choice);
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    }, language);
    await page.goto("/");
    await page.getByRole("button", { name: first.title, exact: true }).click();
    const queue = page.getByRole("region", { name: words.next, exact: true });
    // Allow for a wide scrollbar, even on systems that overlay it.
    await queue.evaluate((panel: HTMLElement) => {
      const missing = 20 - (panel.offsetWidth - panel.clientWidth);
      if (missing > 0) {
        panel.style.paddingInlineEnd = `calc(${getComputedStyle(panel).paddingInlineEnd} + ${String(missing)}px)`;
      }
    });
    const tab = queue.getByRole("tab", { name: words.next });
    const history = queue.getByRole("tab", { name: words.history, exact: true });
    const fold = queue.getByRole("button", { name: words.fold });
    const timer = queue.getByRole("button", { name: words.timer });
    const clear = queue.getByRole("button", { name: words.clear, exact: true });

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        await page.getByRole("button", { name: words.next, exact: true }).click();
      }
      await expect(clear).toBeEnabled();
      expect(await queue.evaluate((panel) => panel.scrollHeight > panel.clientHeight)).toBe(true);
      const tabBox = await tab.boundingBox();
      const historyBox = await history.boundingBox();
      const foldBox = await fold.boundingBox();
      const timerBox = await timer.boundingBox();
      const clearBox = await clear.boundingBox();
      const queueBox = await queue.boundingBox();
      if (!tabBox || !historyBox || !foldBox || !timerBox || !clearBox || !queueBox) {
        throw new Error("Queue header is not visible.");
      }
      expect(clearBox.y + clearBox.height / 2).toBeCloseTo(tabBox.y + tabBox.height / 2, 0);
      expect(historyBox.y).toBeCloseTo(tabBox.y, 0);
      expect(clearBox.width).toBe(foldBox.width);
      expect(clearBox.width).toBe(timerBox.width);
      expect(clearBox.x + clearBox.width).toBeLessThan(queueBox.x + queueBox.width);
    }

    await clear.hover();
    await expect(page.getByRole("tooltip", { name: words.clear })).toBeVisible();
  });
}

/** Return where the seek bar is, once the Track's length lets it move. */
async function seekBar(page: Page) {
  const bar = player(page).getByRole("slider", { name: "Position" });
  await expect(bar).toHaveAttribute("aria-disabled", "false");
  const box = await bar.boundingBox();
  if (box === null) {
    throw new Error("The seek bar isn't on the page.");
  }
  return { bar, box, y: box.y + box.height / 2 };
}

test("hovering the seek bar shows the time a click would move to", async ({ page }) => {
  await play(page, "Alpha");
  const { bar, box, y } = await seekBar(page);

  await page.mouse.move(box.x + box.width * 0.25, y);

  await expect(bar.getByText("0:15")).toBeVisible();
  expect((await audioState(page)).position).toBeLessThan(10);
});

test("clicking the seek bar moves playback to where it was clicked, at once", async ({ page }) => {
  await play(page, "Alpha");
  const { box, y } = await seekBar(page);

  await page.mouse.click(box.x + box.width * (40 / 60), y);

  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThanOrEqual(40);
  expect((await audioState(page)).position).toBeLessThan(41.5);
});

test("the seek bar moves with the keys, each press from where the last one sent it", async ({
  page,
}) => {
  await play(page, "Alpha");
  const { bar } = await seekBar(page);

  await bar.focus();
  // Five tenths of the 60-second Track, then five seconds back: about 0:25.
  for (let press = 0; press < 5; press++) {
    await page.keyboard.press("PageUp");
  }
  await page.keyboard.press("ArrowLeft");

  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThanOrEqual(25);
  expect((await audioState(page)).position).toBeLessThan(28);
});

test("dragging the seek bar moves the audio only once let go", async ({ page }) => {
  await play(page, "Alpha");
  const { bar, box, y } = await seekBar(page);

  await page.mouse.move(box.x + box.width * 0.05, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 12 });

  await expect(bar.getByText(/^0:3\d$/)).toBeVisible();
  expect((await audioState(page)).position).toBeLessThan(10);
  await page.mouse.up();
  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThanOrEqual(35);
  expect((await audioState(page)).position).toBeLessThan(37.5);
  expect((await audioState(page)).playing).toBe(true);
});

/** Alpha paused, with its seek bar in the regular player or Now Playing. */
async function pausedSeek(page: Page, inDialog: boolean) {
  await play(page, "Alpha");
  await player(page).getByRole("button", { name: "Pause" }).click();
  if (inDialog) {
    await player(page).getByRole("button", { name: "Open Now Playing" }).click();
  }
  const scope = inDialog ? page.getByRole("dialog", { name: "Now Playing" }) : player(page);
  const bar = scope.getByRole("slider", { name: "Position" });
  await expect(bar).toHaveAttribute("aria-disabled", "false");
  await bar.focus();
  await page.keyboard.press("Home");
  await expect(bar).toHaveJSProperty("ariaValueNow", "0");
  await expect
    .poll(() =>
      bar.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation instanceof CSSTransition &&
                ["left", "transform"].includes(animation.transitionProperty),
            ).length,
      ),
    )
    .toBe(0);
  return bar;
}

async function thumbGeometry(bar: Locator) {
  return bar.evaluate((element) => {
    const thumb = element.querySelector<HTMLElement>(".seek-thumb");
    if (thumb === null) throw new Error("The seek bar has no thumb.");
    const box = element.getBoundingClientRect();
    const dot = thumb.getBoundingClientRect();
    const scroll = element.closest("dialog") ?? document.documentElement;
    return {
      left: box.left,
      width: box.width,
      center: dot.left + dot.width / 2,
      layoutLeft: thumb.offsetLeft,
      fill: element.querySelector(".seek-fill")?.getBoundingClientRect().right,
      overflow: scroll.scrollWidth - scroll.clientWidth,
    };
  });
}

for (const inDialog of [false, true]) {
  const layout = inDialog ? "Now Playing" : "the regular player";
  test(`the seek thumb moves without changing layout position in ${layout}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const bar = await pausedSeek(page, inDialog);
    await page.setViewportSize({ width: 390, height: 844 });
    const initialPhoneOverflow = (await thumbGeometry(bar)).overflow;
    await page.setViewportSize({ width: 1280, height: 720 });
    await bar.evaluate((element) => {
      const onTransition = (event: Event) => {
        if (
          !(event instanceof TransitionEvent) ||
          !["left", "transform"].includes(event.propertyName)
        )
          return;
        for (const animation of element.getAnimations({ subtree: true })) {
          if (
            animation instanceof CSSTransition &&
            ["left", "transform"].includes(animation.transitionProperty)
          ) {
            animation.pause();
            animation.currentTime = 0;
          }
        }
        element.setAttribute("data-motion-ready", "");
        element.removeEventListener("transitionrun", onTransition);
      };
      element.addEventListener("transitionrun", onTransition);
    });

    await page.keyboard.press("ArrowRight");
    await expect(bar).toHaveAttribute("data-motion-ready");
    expect(
      await bar.locator(".seek-thumb-position").evaluate((element) =>
        element
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.transitionProperty),
      ),
    ).toEqual(["transform"]);
    const positions = [];
    for (const time of [0, 130]) {
      const durations = await bar.evaluate((element, at) => {
        return element.getAnimations({ subtree: true }).flatMap((animation) => {
          if (
            !(animation instanceof CSSTransition) ||
            !["left", "transform"].includes(animation.transitionProperty)
          )
            return [];
          animation.currentTime = at;
          return animation.effect?.getTiming().duration ?? [];
        });
      }, time);
      expect(durations.length).toBeGreaterThanOrEqual(2);
      expect(durations.every((duration) => duration === 260)).toBe(true);
      positions.push(await thumbGeometry(bar));
    }

    const [start, middle] = positions;
    if (!start || !middle) throw new Error("Missing motion samples.");
    const target = start.left + start.width * (5 / 60);
    expect(middle.center).toBeGreaterThan(start.center + 1);
    expect(middle.center).toBeLessThan(target - 1);
    expect(Math.abs(middle.center - (start.center + target) / 2)).toBeLessThan(0.75);
    for (const position of positions) {
      expect(position.layoutLeft).toBe(start.layoutLeft);
      expect(Math.abs(position.center - (position.fill ?? NaN))).toBeLessThan(0.75);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const resized = await thumbGeometry(bar);
    expect(Math.abs(resized.center - (resized.left + resized.width * (2.5 / 60)))).toBeLessThan(
      0.75,
    );
    expect(Math.abs(resized.center - (resized.fill ?? NaN))).toBeLessThan(0.75);
    expect(resized.overflow).toBeLessThanOrEqual(initialPhoneOverflow + 1);
    await page.setViewportSize({ width: 1280, height: 720 });
    await bar.evaluate((element) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (animation instanceof CSSTransition) animation.currentTime = 260;
      }
    });
    const end = await thumbGeometry(bar);
    expect(Math.abs(end.center - (end.left + end.width * (5 / 60)))).toBeLessThan(0.75);
    expect(end.layoutLeft).toBe(start.layoutLeft);
  });

  test(`the seek thumb follows held and reduced-motion positions immediately in ${layout}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    const bar = await pausedSeek(page, inDialog);

    await page.keyboard.press("PageUp");

    const reduced = await thumbGeometry(bar);
    expect(Math.abs(reduced.center - (reduced.left + reduced.width * 0.1))).toBeLessThan(0.75);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const box = await bar.boundingBox();
    if (box === null) throw new Error("The seek bar is missing.");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, y);

    const held = await thumbGeometry(bar);
    expect(Math.abs(held.center - (held.left + held.width * 0.7))).toBeLessThan(0.75);
    expect((await audioState(page)).position).toBeLessThan(7);
    await page.mouse.up();
    await expect.poll(async () => (await audioState(page)).position).toBeCloseTo(42, 0);
  });

  test(`the seek thumb keeps its endpoint hit targets without widening ${layout}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const bar = await pausedSeek(page, inDialog);
    for (const fallback of [false, true]) {
      if (fallback) {
        const removed = await page.evaluate(() => {
          let count = 0;
          for (const sheet of document.styleSheets) {
            for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
              const rule = sheet.cssRules[index];
              if (
                rule instanceof CSSSupportsRule &&
                rule.conditionText.includes("overflow-clip-margin")
              ) {
                sheet.deleteRule(index);
                count++;
              }
            }
          }
          return count;
        });
        expect(removed).toBe(1);
      }
      for (const width of [1280, 768, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await bar.evaluate((element) => {
          (element as HTMLElement).style.setProperty("--played", "0");
        });
        const initialOverflow = (await thumbGeometry(bar)).overflow;
        for (const share of [0, 0.5, 1]) {
          // These are the renderer's position inputs; seeking behavior is checked separately.
          await bar.evaluate((element, at) => {
            (element as HTMLElement).style.setProperty("--played", String(at));
          }, share);
          const geometry = await thumbGeometry(bar);
          expect(Math.abs(geometry.center - (geometry.left + geometry.width * share))).toBeLessThan(
            0.75,
          );
          expect(geometry.overflow).toBeLessThanOrEqual(initialOverflow + 1);
          expect(
            await bar.evaluate((element, at) => {
              const thumb = element.querySelector(".seek-thumb");
              if (thumb === null) throw new Error("Missing thumb.");
              const box = thumb.getBoundingClientRect();
              const x =
                at === 0 ? box.left + 2 : at === 1 ? box.right - 2 : box.left + box.width / 2;
              return (
                document.elementFromPoint(x, box.top + box.height / 2)?.closest(".seek") === element
              );
            }, share),
          ).toBe(true);
        }
      }
    }
  });
}

test.describe("touch seek visibility", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("the thumb stays visible and taps seek in both player layouts", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    const idle = player(page).getByRole("slider", { name: "Position" });
    await expect(idle).toHaveAttribute("aria-disabled", "true");
    await expect(idle.locator(".seek-thumb")).toHaveCSS("opacity", "0");
    await page.getByRole("button", { name: "Alpha", exact: true }).tap();
    await player(page).getByRole("button", { name: "Pause" }).tap();

    for (const inDialog of [false, true]) {
      if (inDialog) await player(page).getByRole("button", { name: "Open Now Playing" }).tap();
      const scope = inDialog ? page.getByRole("dialog", { name: "Now Playing" }) : player(page);
      const bar = scope.getByRole("slider", { name: "Position" });
      await expect(bar.locator(".seek-thumb")).toHaveCSS("opacity", "1");
      const box = await bar.boundingBox();
      if (box === null) throw new Error("Missing seek bar.");
      const share = inDialog ? 0.65 : 0.25;

      await page.touchscreen.tap(box.x + box.width * share, box.y + box.height / 2);

      await expect.poll(async () => (await audioState(page)).position).toBeCloseTo(60 * share, 0);
    }
  });
});

test("the seek thumb stays hidden with unknown duration in both player layouts", async ({
  page,
}) => {
  await page.route("**/api/sources/*/audio", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();

  for (const inDialog of [false, true]) {
    if (inDialog) await player(page).getByRole("button", { name: "Open Now Playing" }).click();
    const scope = inDialog ? page.getByRole("dialog", { name: "Now Playing" }) : player(page);
    const bar = scope.getByRole("slider", { name: "Position" });
    await bar.focus();

    await expect(bar).toHaveAttribute("aria-disabled", "true");
    await expect(bar.locator(".seek-thumb")).toHaveCSS("opacity", "0");
  }
});

test("pausing stops the audio, and playing goes on", async ({ page }) => {
  await play(page, "Alpha");

  await player(page).getByRole("button", { name: "Pause" }).click();
  await expect.poll(async () => (await audioState(page)).playing).toBe(false);
  await player(page).getByRole("button", { name: "Play", exact: true }).click();

  await expect.poll(async () => (await audioState(page)).playing).toBe(true);
});

test("Now Playing, opened from the player's cover, pauses the song from its own controls", async ({
  page,
}) => {
  await play(page, "Alpha");
  await player(page).getByRole("button", { name: "Open Now Playing" }).click();
  const nowPlaying = page.getByRole("dialog", { name: "Now Playing" });
  await expect(nowPlaying.getByRole("heading", { name: "Alpha" })).toBeVisible();

  await nowPlaying.getByRole("button", { name: "Pause" }).click();

  await expect.poll(async () => (await audioState(page)).playing).toBe(false);
});

test("with no lyrics, Now Playing says so level with the player, mirroring the cover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/tracks/*/lyrics", (route) => route.fulfill({ json: null }));
  await play(page, "Alpha");

  await player(page).getByRole("button", { name: "Open Now Playing" }).click();

  const nowPlaying = page.getByRole("dialog", { name: "Now Playing" });
  const none = nowPlaying.getByText("No lyrics for this song.");

  await expect(none).toBeVisible();
  const middle = (box: { x: number; y: number; width: number; height: number } | null) => ({
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  });
  const stage = middle(await nowPlaying.locator(".np-stage").boundingBox());
  const cover = middle(await nowPlaying.locator(".np-art").boundingBox());
  const main = middle(await nowPlaying.locator(".np-main").boundingBox());
  const said = middle(await none.boundingBox());
  expect(Math.abs(said.x - (2 * stage.x - cover.x))).toBeLessThan(16);
  expect(Math.abs(said.y - main.y)).toBeLessThan(16);
});

/** Return where `element` is once it stops moving, as Now Playing does while it opens. */
async function stillBox(element: Locator) {
  // The first read has nothing to compare with, so two reads in one frame can't pass as still.
  let last: Awaited<ReturnType<Locator["boundingBox"]>> | undefined;
  await expect
    .poll(
      async () => {
        const now = await element.boundingBox();
        const still = last !== undefined && now?.x === last?.x && now?.y === last?.y;
        last = now;
        return still;
      },
      { intervals: [100] },
    )
    .toBe(true);
  return last;
}

test("Now Playing keeps the lyrics close beside the cover, and Up next opens over them without moving it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/tracks/*/lyrics", (route) => route.fulfill({ json: null }));
  await play(page, "Alpha");
  await player(page).getByRole("button", { name: "Open Now Playing" }).click();
  const nowPlaying = page.getByRole("dialog", { name: "Now Playing" });
  await expect(nowPlaying.getByText("No lyrics for this song.")).toBeVisible();
  // The cover's column, which stays still while the cover eases in and out of resting.
  const column = nowPlaying.locator(".np-main");
  const before = await stillBox(column);
  const lyrics = await nowPlaying.getByRole("region", { name: "Lyrics" }).boundingBox();

  await nowPlaying.getByRole("button", { name: "Up next" }).click();

  const upNext = nowPlaying.getByRole("region", { name: "Up next" });
  await expect(upNext).toBeVisible();
  const after = await stillBox(column);
  const queue = await upNext.boundingBox();
  const columnRight = (before?.x ?? 0) + (before?.width ?? 0);
  expect((lyrics?.x ?? 0) - columnRight).toBeLessThan(96);
  expect(after).toEqual(before);
  expect(queue?.x ?? 0).toBeGreaterThan(columnRight);
});

test("a Track that ends moves on to the next", async ({ page }) => {
  await play(page, "Charlie");

  await expect(player(page).getByText("Delta", { exact: true })).toBeVisible();
});

test("a compressed Track is prepared, then plays", async ({ page }) => {
  await play(page, "Delta");

  await expect.poll(async () => (await audioState(page)).playing, { timeout: 30_000 }).toBe(true);
});

test("Next and Previous move through the queue", async ({ page }) => {
  await play(page, "Alpha");

  await player(page).getByRole("button", { name: "Next" }).click();
  await expect(player(page).getByText("Bravo", { exact: true })).toBeVisible();
  await player(page).getByRole("button", { name: "Previous" }).click();

  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
});

test("choosing a Track queues the whole list, so Previous reaches the Tracks before it", async ({
  page,
}) => {
  await play(page, "Bravo");
  await player(page).getByRole("button", { name: "Pause" }).click();

  await player(page).getByRole("button", { name: "Previous" }).click();

  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
});

test("shuffle reorders what plays next, and turned off puts it back", async ({ page }) => {
  await play(page, "Alpha");
  const shuffle = player(page).getByRole("button", { name: "Shuffle" });

  await shuffle.click();

  await expect(shuffle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Shuffle on." })).toBeAttached();
  const shuffled = await upNext(page).allTextContents();
  expect(shuffled.map((text) => /Bravo|Charlie|Delta/.exec(text)?.[0]).sort()).toEqual([
    "Bravo",
    "Charlie",
    "Delta",
  ]);
  await shuffle.click();
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);
});

test("repeat one starts the Track over when it ends", async ({ page }) => {
  await page.goto("/");
  const repeat = player(page).getByRole("button", { name: /^Repeat/ });
  await repeat.click();
  await repeat.click();
  await expect(repeat).toHaveAccessibleName("Repeat: one");
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.dataset.ends = "0";
    audio.addEventListener("ended", () => {
      audio.dataset.ends = String(Number(audio.dataset.ends) + 1);
    });
  });

  await page.getByRole("button", { name: "Charlie", exact: true }).click();

  await expect(page.locator("audio")).not.toHaveAttribute("data-ends", "0");
  await expect(player(page).getByText("Charlie", { exact: true })).toBeVisible();
  await expect.poll(async () => (await audioState(page)).playing).toBe(true);
});

test("repeat all plays the first Track after the last", async ({ page }) => {
  await page.goto("/");
  const repeat = player(page).getByRole("button", { name: /^Repeat/ });
  await repeat.click();
  await expect(repeat).toHaveAccessibleName("Repeat: all");
  await expect(page.getByRole("status").filter({ hasText: "Repeating the queue." })).toBeAttached();
  await page.getByRole("button", { name: "Delta", exact: true }).click();

  await player(page).getByRole("button", { name: "Next" }).click();

  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
});

test("a reload keeps the queue, paused where it was", async ({ page }) => {
  await play(page, "Alpha");
  const { box, y } = await seekBar(page);
  await page.mouse.click(box.x + box.width * (22 / 60), y);
  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThanOrEqual(21);

  await page.reload();

  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
  await expect(player(page).getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect.poll(async () => (await audioState(page)).position).toBeGreaterThanOrEqual(20);
  expect((await audioState(page)).playing).toBe(false);
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);
});

test("dragging a Track by its handle puts it in another place in the queue", async ({ page }) => {
  await play(page, "Alpha");
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);
  const queue = page.getByRole("region", { name: "Up next" });

  await queue
    .getByRole("button", { name: "Reorder Delta" })
    .dragTo(queue.getByRole("button", { name: "Reorder Bravo" }), { steps: 12 });

  await expect(upNext(page)).toHaveText([/Delta/, /Bravo/, /Charlie/]);
});

test("the keyboard moves a Track in the queue as dragging does", async ({ page }) => {
  await play(page, "Alpha");
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);

  // Each step waits for what a screen reader hears, as a listener would.
  await page.getByRole("button", { name: "Reorder Bravo" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Picked up Bravo.")).toBeAttached();
  // The sensor starts hearing keys a timeout after the pickup; this one runs after it.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Bravo would play second.")).toBeAttached();
  await page.keyboard.press("Space");

  await expect(upNext(page)).toHaveText([/Charlie/, /Bravo/, /Delta/]);
});

for (const [language, inDialog] of [
  ["en", false],
  ["zh-Hans", true],
] as const) {
  test(`during playback, dragging past a folded album keeps the full queue order in ${language}`, async ({
    page,
    request,
  }) => {
    const response = await request.get("/api/tracks");
    const original = ((await response.json()) as Track[]).find((track) => track.title === "Alpha");
    if (original === undefined) throw new Error("The test library has no Alpha.");
    const ready = await request.post(`/api/tracks/${String(original.id)}/playback`);
    expect(ready.ok()).toBe(true);
    const playback: unknown = await ready.json();
    const file = 90000;
    const tracks: Track[] = [
      { ...original, track_number: 1 },
      { ...original, id: 90001, title: "Bravo", track_number: 2 },
      { ...original, id: file, title: "Album file", kind: "album", split: true },
      { ...original, id: 90002, title: "Charlie 1", segment_of: file, track_number: 3 },
      { ...original, id: 90003, title: "Charlie 2", segment_of: file, track_number: 4 },
      { ...original, id: 90004, title: "Delta", track_number: 5 },
    ];
    await page.route("**/api/tracks", (route) => route.fulfill({ json: tracks }));
    await page.route("**/api/tracks/*/playback", (route) => route.fulfill({ json: playback }));
    await page.addInitScript(() => {
      localStorage.setItem("medleyplay.language", "en");
    });
    await page.emulateMedia({ colorScheme: inDialog ? "dark" : "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    await expect.poll(async () => (await audioState(page)).position).toBeGreaterThan(0.5);
    const started = (await audioState(page)).position;
    const panel = page.locator("#queue");
    await expect(panel.locator(".entry-title")).toHaveText([
      "Bravo",
      "Charlie 1",
      "Charlie 2",
      "Delta",
    ]);
    await panel.locator(".queue-album .fold").click();
    if (inDialog) {
      await page.getByRole("button", { name: "Open Now Playing" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Up next", exact: true }).click();
    }
    const queue = inDialog ? page.locator("#now-playing-queue") : panel;
    const titles = queue.locator(".entry-title");
    if (inDialog) {
      await expect(titles).toHaveText(["Bravo", "Charlie 1", "Charlie 2", "Delta"]);
      await queue.locator(".queue-album .fold").click();
    }
    await expect(titles).toHaveText(["Bravo", "Delta"]);
    if (language !== "en") {
      // A language choice in another tab reaches this mounted queue through storage.
      const otherTab = await page.context().newPage();
      await otherTab.goto("/api/setup");
      await otherTab.evaluate((choice) => {
        localStorage.setItem("medleyplay.language", choice);
      }, language);
      await otherTab.close();
      await page.bringToFront();
    }
    const announcements = inDialog ? page.getByRole("dialog") : queue;
    const reorder = (title: string) =>
      queue.getByRole("button", {
        name: language === "en" ? `Reorder ${title}` : `调整「${title}」的顺序`,
      });

    await reorder("Bravo").focus();
    await page.keyboard.press("Space");
    await expect(
      announcements.getByText(
        language === "en" ? "Picked up Bravo." : "已选中「Bravo」，可以移动。",
        {
          exact: true,
        },
      ),
    ).toBeAttached();
    // The keyboard sensor attaches its listener after pickup.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await page.keyboard.press("ArrowDown");
    await expect(
      announcements.getByText(
        language === "en" ? "Bravo would play fourth." : "「Bravo」将第 4 首播放。",
        {
          exact: true,
        },
      ),
    ).toBeAttached();
    await page.keyboard.press("Space");
    await expect(
      announcements.getByText(
        language === "en" ? "Bravo plays fourth." : "「Bravo」已调整为第 4 首播放。",
        { exact: true },
      ),
    ).toBeAttached();
    await queue.locator(".queue-album .fold").click();
    await expect(titles).toHaveText(["Charlie 1", "Charlie 2", "Delta", "Bravo"]);

    await page.setViewportSize({ width: 390, height: 900 });
    if (!inDialog) await page.getByRole("button", { name: "Up next", exact: true }).click();
    await reorder("Bravo").dragTo(reorder("Delta"), { steps: 12 });
    await expect(titles).toHaveText(["Charlie 1", "Charlie 2", "Bravo", "Delta"]);
    await queue
      .getByRole("button", { name: language === "en" ? "Remove Delta" : "移除「Delta」" })
      .click();

    await expect(titles).toHaveText(["Charlie 1", "Charlie 2", "Bravo"]);
    expect((await audioState(page)).playing).toBe(true);
    expect((await audioState(page)).position).toBeGreaterThan(started);
  });
}

test("a theme chosen holds over the system's, and across a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");

  await page.getByRole("radio", { name: "Dark" }).click();
  await page.reload();

  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Match the system" }).click();
  await expect(html).not.toHaveAttribute("data-theme");
});

const volumeOf = (page: Page) =>
  page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.volume);

test("the volume buttons step it one mark, and the volume stays after a reload", async ({
  page,
}) => {
  await play(page, "Alpha");

  await player(page).getByRole("button", { name: "Volume down" }).click();
  await player(page).getByRole("button", { name: "Volume down" }).click();
  await player(page).getByRole("button", { name: "Volume up" }).click();

  await expect.poll(() => volumeOf(page)).toBeCloseTo(0.9);
  await page.reload();
  await expect.poll(() => volumeOf(page)).toBeCloseTo(0.9);
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute(
    "aria-valuetext",
    "90%",
  );
});

test("dragging the volume bar changes the volume only once let go", async ({ page }) => {
  await play(page, "Alpha");
  const bar = await player(page).getByRole("slider", { name: "Volume" }).boundingBox();
  if (bar === null) {
    throw new Error("The volume bar isn't on the page.");
  }
  const y = bar.y + bar.height / 2;

  await page.mouse.move(bar.x + bar.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.3, y, { steps: 8 });

  expect(await volumeOf(page)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => volumeOf(page)).toBeLessThan(0.5);
});

test("Play all plays the view's songs in its order", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Play all" }).click();

  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
  await expect(upNext(page)).toHaveText([/Bravo/, /Charlie/, /Delta/]);
  await expect(player(page).getByRole("button", { name: "Shuffle" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("Shuffle all plays every song of the view, shuffled", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Shuffle all" }).click();

  await expect(player(page).getByRole("button", { name: "Shuffle" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(upNext(page)).toHaveCount(3);
  const playing = await player(page).locator(".names strong").textContent();
  const next = (await upNext(page).allTextContents()).map(
    (text) => /Alpha|Bravo|Charlie|Delta/.exec(text)?.[0],
  );
  expect([playing, ...next].sort()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
});
