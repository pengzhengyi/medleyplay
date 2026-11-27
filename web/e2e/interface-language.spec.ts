import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`the language switch translates help and controls without translating music at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/settings");
    const main = page.getByRole("main");
    const language = main.getByRole("combobox", { name: "Language" });
    await expect(main.getByText("The color of buttons, links, and what's playing.")).toBeVisible();

    await language.focus();
    await language.selectOption("zh-Hans");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
    await expect(main.getByRole("combobox", { name: "语言" })).toBeFocused();
    await expect(main.getByRole("navigation", { name: "设置分类" })).toBeVisible();
    const appearance = main.getByRole("region", { name: "外观" });
    const help = appearance.getByText(/按钮、链接和正在播放/u);
    await expect(help).toBeVisible();
    expect(
      await help.evaluate((element) => {
        const card = element.closest(".settings-section");
        if (card === null) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth;
      }),
    ).toBe(true);

    await page.goto("/#/downloaded");
    await expect(main.getByText(/从音乐网站添加歌曲后/u)).toBeVisible();
    await page.goto("/");
    await expect(main.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "搜索" })).toBeVisible();
  });
}
