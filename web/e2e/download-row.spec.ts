import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`a Downloading row keeps its progress and keyboard menu visible at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    const response = await page.request.get("/api/tracks");
    const tracks = (await response.json()) as readonly { id: number; title: string }[];
    const track = tracks.find(({ title }) => title === "Alpha");
    if (track === undefined) throw new Error("The test Library does not have Alpha.");
    await page.route("**/api/downloads", (route) =>
      route.fulfill({
        json: [
          {
            track_id: track.id,
            job: {
              id: 501,
              requested_by: 1,
              state: "running",
              progress: { message: "Joining part 3 (3/5)", fraction: 0.6 },
              waits_for_online: false,
            },
          },
        ],
      }),
    );
    await page.goto("/#/downloaded");
    const downloading = page.getByRole("region", { name: "Downloading" });
    const actions = downloading.getByRole("button", { name: "Download actions for Alpha" });

    await expect(downloading.getByRole("progressbar", { name: "Alpha" })).toHaveAttribute(
      "value",
      "0.6",
    );
    await expect(actions).toBeInViewport({ ratio: 1 });
    await actions.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Cancel download" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
  });
}
