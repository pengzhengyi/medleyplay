import { expect, test } from "@playwright/test";

test("a storage limit an admin types saves on its own, and the server keeps it", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const storage = page.getByRole("region", { name: "Downloads and storage" });
  const size = storage.getByRole("spinbutton", { name: "Limit in GB" });

  await page.getByRole("radio", { name: /Up to/ }).check();
  await size.fill("5");
  await size.blur();
  await expect(storage.getByText("Saved.")).toBeVisible();
  await page.reload();

  await expect(size).toHaveValue("5");
  await expect(page.getByText(/of 5 GB used/)).toBeVisible();
  // Put the limit back as the other tests expect it.
  await page.getByRole("radio", { name: "No limit" }).check();
  await expect(storage.getByText("Saved.")).toBeVisible();
});

test("the theme chosen in Settings is the one the header shows", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  const settings = page.getByRole("main");

  await settings.getByRole("radio", { name: "Dark" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("banner").getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await settings.getByRole("radio", { name: "Match the system" }).click();
});
