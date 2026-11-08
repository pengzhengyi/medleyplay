import { type Page, expect, test } from "@playwright/test";

const queuePanel = (page: Page) => page.getByRole("region", { name: "Up next" });
const player = (page: Page) => page.getByRole("region", { name: "Player" });

/** Record that the signed-in Account played `title` a few minutes ago, as a page would. */
async function recordPlayOf(page: Page, title: string): Promise<void> {
  const tracks = (await (await page.request.get("/api/tracks")).json()) as {
    id: number;
    title: string;
  }[];
  const track = tracks.find((each) => each.title === title);
  const recorded = await page.request.put(`/api/plays/${crypto.randomUUID()}`, {
    data: { track_id: track?.id, played_at: new Date(Date.now() - 5 * 60_000).toISOString() },
  });
  expect(recorded.ok()).toBe(true);
}

test("History lists a song played, plays it again, and clears once asked twice", async ({
  page,
}) => {
  await page.goto("/");
  await recordPlayOf(page, "Alpha");
  await queuePanel(page).getByRole("tab", { name: "History" }).click();
  const history = queuePanel(page).getByRole("tabpanel", { name: "History" });

  await history.getByRole("button", { name: "Play Alpha, 5 min ago" }).first().click();
  await expect(player(page).getByText("Alpha", { exact: true })).toBeVisible();

  await queuePanel(page).getByRole("button", { name: "Clear" }).click();
  await queuePanel(page)
    .getByRole("group", { name: "Clear History" })
    .getByRole("button", { name: "Clear" })
    .click();
  await expect(history.getByText(/^Nothing played yet\./u)).toBeVisible();
});
