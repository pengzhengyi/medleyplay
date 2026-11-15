import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteMark } from "./SiteMark";

describe("a site's mark", () => {
  it("shows Bilibili as its mark, keeping its name for a screen reader", () => {
    render(
      <a href="#bilibili">
        <SiteMark name="Bilibili" />
      </a>,
    );

    const link = screen.getByRole("link", { name: "Bilibili" });
    expect(link.querySelector("svg.site-mark")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a site with no mark known by its name", () => {
    render(
      <a href="#elsewhere">
        <SiteMark name="YouTube" />
      </a>,
    );

    const link = screen.getByRole("link", { name: "YouTube" });
    expect(link.querySelector("svg")).toBeNull();
  });
});
