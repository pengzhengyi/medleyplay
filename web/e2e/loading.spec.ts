import { expect, test } from "@playwright/test";

test("the page's scripts and styles arrive gzipped, and kept for good", async ({
  page,
  request,
}) => {
  const assets: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/assets/")) {
      assets.push(response.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  expect(assets.length).toBeGreaterThan(0);

  const entry = await request.get(assets[0] ?? "", { headers: { "Accept-Encoding": "gzip" } });

  expect(entry.headers()["content-encoding"]).toBe("gzip");
  expect(entry.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
});

test("Edit details opens at once, with no frame of nothing in between", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("row").filter({ hasText: "Alpha" }).first();
  await row.getByRole("button", { name: "More actions for Alpha" }).click();

  await page.getByRole("menuitem", { name: "Edit details…" }).click();

  await expect(page.getByRole("dialog", { name: "Edit details" })).toBeVisible({ timeout: 1000 });
});
