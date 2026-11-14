import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Nav } from "./Nav";

describe("moving between views", () => {
  it("puts Clean up under Insights, saying how many names wait", () => {
    render(<Nav route={{ view: "library" }} toDo={30} />);

    const links = screen.getAllByRole("link");
    const cleanUp = screen.getByRole("link", { name: /^Clean up/ });
    expect(links.at(-2)).toBe(cleanUp);
    expect(links.at(-3)).toHaveAccessibleName(/^Insights/);
    expect(links.at(-1)).toHaveAccessibleName("Settings");
    expect(cleanUp).toHaveAccessibleName("Clean up, 30 names to clean up");
    expect(cleanUp).toHaveAttribute("href", "#/clean-up");
  });

  it("gives Insights the count too, for a phone, whose tab bar leaves Clean up out", () => {
    render(<Nav route={{ view: "library" }} toDo={1} />);

    const insights = screen.getByRole("link", { name: "Insights, 1 name to clean up" });

    expect(insights).toHaveTextContent("Insights1");
  });

  it("shows no count while nothing waits", () => {
    render(<Nav route={{ view: "clean-up" }} />);

    expect(screen.getByRole("link", { name: "Clean up" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Insights" })).toBeInTheDocument();
  });
});
