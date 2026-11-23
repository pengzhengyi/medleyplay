import { expect, type Locator, test } from "@playwright/test";

for (const [reducedMotion, motion] of [
  ["no-preference", "spins"],
  ["reduce", "stays still"],
] as const) {
  test(`the starting ring ${motion} in the same place before and after React`, async ({ page }) => {
    let runScripts: () => void = () => undefined;
    const scripts = new Promise<void>((resolve) => {
      runScripts = resolve;
    });
    await page.emulateMedia({ reducedMotion });
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "script") await scripts;
      await route.fallback();
    });
    await page.route("**/api/device", () => undefined);

    await page.goto("/", { waitUntil: "commit" });
    const mark = page.getByText("medleyplay", { exact: true });

    try {
      await expect(mark).toHaveAttribute("aria-busy", "true");
      await expect
        .poll(() => startingRing(mark))
        .toMatchObject({
          drawn: true,
          rotating: reducedMotion === "no-preference",
        });
      const preboot = await mark.elementHandle();
      const beforeReact = await startingRing(mark);

      runScripts();
      await expect.poll(() => preboot.evaluate((element) => element.isConnected)).toBe(false);

      await expect(mark).toHaveAttribute("aria-busy", "true");
      expect(await startingRing(mark)).toEqual(beforeReact);
    } finally {
      runScripts();
    }
  });
}

function startingRing(mark: Locator) {
  return mark.evaluate((element) => {
    const ring = getComputedStyle(element, "::before");
    const text = document.createRange();
    text.selectNodeContents(element);
    const { x, y } = text.getBoundingClientRect();
    return {
      drawn:
        ring.backgroundImage === "none" &&
        ring.borderTopWidth !== "0px" &&
        ring.borderTopColor !== ring.borderRightColor,
      rotating: ring.animationName !== "none" && ring.animationPlayState === "running",
      width: ring.width,
      height: ring.height,
      x,
      y,
    };
  });
}

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
