import { type Page, expect as baseExpect, test } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 15_000 });

async function devices(page: Page) {
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  return page.getByRole("dialog", { name: "Devices" });
}

const player = (page: Page) => page.getByRole("region", { name: "Player" });
const playing = (page: Page) =>
  page.locator("audio").evaluate((audio: HTMLAudioElement) => !audio.paused);

async function showsSongOnPhone(page: Page, title: string) {
  await player(page).getByRole("button", { name: "Open Now Playing" }).click();
  const now = page.getByRole("dialog", { name: "Now Playing" });
  await expect(now.getByText(title, { exact: true })).toBeVisible();
  await now.getByRole("button", { name: "Close Now Playing" }).click();
}

for (const width of [390, 1280]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the Devices window fits at ${String(width)}px in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme });
      await page.route("**/api/addresses", (route) =>
        route.fulfill({ json: { addresses: [], share_url: "http://192.0.2.1:8000" } }),
      );
      await page.route("**/api/devices", (route) =>
        route.fulfill({
          json: {
            admission: "ask",
            revision: 1,
            waiting: [
              {
                id: "fedcba9876543210",
                label: "Safari on iPhone",
                address: "192.0.2.12",
                code: "4821",
                since: "2026-11-27T18:00:00Z",
              },
            ],
            allowed: [],
          },
        }),
      );
      await page.goto("/");

      const dialog = await devices(page);
      await expect(
        dialog.getByRole("img", { name: "QR code of http://192.0.2.1:8000" }),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
      await expect
        .poll(() =>
          dialog.evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth &&
              element.getBoundingClientRect().right <= window.innerWidth,
          ),
        )
        .toBe(true);

      await page.route("**/api/device", (route) =>
        route.fulfill({ json: { presence: "allowed", label: "Safari on iPhone", code: null } }),
      );
      await page.reload();
      const connected = await devices(page);
      await expect(connected.getByRole("radio", { name: /^Client/u })).toBeChecked();
      await expect(connected.getByRole("radio", { name: /^Remote/u })).toBeVisible();
      await expect(connected.getByText(new URL(page.url()).origin)).toBeVisible();
      await expect(connected.getByRole("img")).toHaveCount(0);
    });
  }
}

test("the computer and a Client play independently while Remote controls only the computer", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect.poll(() => playing(page)).toBe(true);

  const context = await browser.newContext({
    baseURL: baseURL ?? "http://127.0.0.1:4174",
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
  });
  try {
    const phone = await context.newPage();
    await phone.route("**/api/device", (route) =>
      route.fulfill({ json: { presence: "allowed", label: "Safari on iPhone", code: null } }),
    );
    await phone.goto("/");
    await phone.getByRole("button", { name: "Bravo", exact: true }).click();
    await expect.poll(() => playing(phone)).toBe(true);
    await showsSongOnPhone(phone, "Bravo");
    await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();
    expect(await playing(page)).toBe(true);

    const phoneWindow = await devices(phone);
    await phoneWindow.getByRole("radio", { name: /^Remote/u }).check();
    await phoneWindow.getByRole("button", { name: "Close", exact: true }).click();
    await showsSongOnPhone(phone, "Alpha");
    expect(await playing(phone)).toBe(false);
    expect(await playing(page)).toBe(true);

    await player(phone).getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(() => playing(page)).toBe(false);
    await player(phone).getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => playing(page)).toBe(true);

    const back = await devices(phone);
    await back.getByRole("radio", { name: /^Client/u }).check();
    await back.getByRole("button", { name: "Close", exact: true }).click();
    await showsSongOnPhone(phone, "Bravo");
    expect(await playing(phone)).toBe(false);
    expect(await playing(page)).toBe(true);
  } finally {
    await context.close();
  }
});
