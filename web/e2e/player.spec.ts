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
