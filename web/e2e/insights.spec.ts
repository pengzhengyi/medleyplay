import { type Page, expect, test } from "@playwright/test";

const player = (page: Page) => page.getByRole("region", { name: "Player" });

/** Record that the signed-in Account played `title` an hour ago, as a page would. */
async function recordPlayOf(page: Page, title: string): Promise<void> {
  const tracks = (await (await page.request.get("/api/tracks")).json()) as {
    id: number;
    title: string;
  }[];
  const track = tracks.find((each) => each.title === title);
  const recorded = await page.request.put(`/api/plays/${crypto.randomUUID()}`, {
    data: { track_id: track?.id, played_at: new Date(Date.now() - 60 * 60_000).toISOString() },
  });
  expect(recorded.ok()).toBe(true);
}

test("Insights ranks a song played in the last 30 days, and plays it from there", async ({
  page,
}) => {
  await page.goto("/");
  await recordPlayOf(page, "Bravo");

  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Insights" })
    .click();

  await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
  const topSongs = page.getByRole("region", { name: "Top songs" });
  await topSongs.getByRole("button", { name: /^Play Bravo, \d+ plays?$/u }).click();
  await expect(player(page).getByText("Bravo", { exact: true })).toBeVisible();
});
