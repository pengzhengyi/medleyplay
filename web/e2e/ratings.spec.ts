// cspell:ignore Hachi

import { expect, test } from "@playwright/test";

/** A Rate Your Music export, as a 2020 export writes it, rating two albums the Library hasn't. */
const EXPORT = `RYM Album, First Name,Last Name,First Name localized, Last Name localized,Title,Release_Date,Rating,Ownership,Purchase Date,Media Type,Review
"1001","","\\u{30cf}\\u{30c1}","","Hachi","Bremen","2015","9","n","","",  ""
"1002","Tony","Allen","","","Film of Life","2014","7","o","","CD",  "Warm &amp; loose."
`;

test("Settings previews a Rate Your Music export, imports it, and forgets it", async ({ page }) => {
  await page.goto("/#/settings");
  const section = page.getByRole("region", { name: "Your ratings" });

  await section.getByLabel("Rate Your Music export").setInputFiles({
    name: "export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(EXPORT),
  });
  const preview = section.getByRole("region", { name: "Before you import" });
  await expect(preview).toContainText("2 albums rated or reviewed; your Library has 0 of them.");
  await preview.getByText("2 albums aren't in your Library").click();
  await expect(preview.getByText("ハチ – Bremen")).toBeVisible();

  await preview.getByRole("button", { name: "Import" }).click();
  await expect(section.getByText("Your import has 2 albums.")).toBeVisible();

  await section.getByRole("button", { name: "Forget the import" }).click();
  await expect(section.getByText("Forgot the import.")).toBeVisible();
  await expect(section.getByRole("button", { name: "Forget the import" })).toBeHidden();
});
