import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`the Language dropdown is compact with an inset keyboard focus ring at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/settings");
    const appearance = page.getByRole("region", { name: "Appearance" });
    const language = appearance.getByRole("combobox", { name: "Language" });

    await appearance.getByRole("button", { name: "Appearance", exact: true }).focus();
    await page.keyboard.press("Tab");

    await expect(language).toBeFocused();
    const layout = await language.evaluate((select: HTMLSelectElement) => {
      const label = [...select.labels].at(0)?.firstChild;
      if (label == null) throw new Error("The control has no visible label.");
      const text = document.createRange();
      text.selectNodeContents(label);
      const box = select.getBoundingClientRect();
      const focus = getComputedStyle(select);
      return {
        gap: box.left - text.getBoundingClientRect().right,
        width: box.width,
        height: box.height,
        ringStyle: focus.outlineStyle,
        ringWidth: Number.parseFloat(focus.outlineWidth),
        ringOffset: Number.parseFloat(focus.outlineOffset),
        shadow: focus.boxShadow,
      };
    });
    expect(layout.gap).toBeGreaterThanOrEqual(8);
    expect(layout.width).toBeLessThan(210);
    expect(layout.height).toBeGreaterThanOrEqual(32);
    expect(layout.height).toBeLessThanOrEqual(40);
    expect(layout.ringStyle).toBe("solid");
    expect(layout.ringWidth).toBeGreaterThanOrEqual(2);
    expect(layout.ringOffset).toBeLessThan(0);
    expect(layout.shadow).toBe("none");
  });

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
