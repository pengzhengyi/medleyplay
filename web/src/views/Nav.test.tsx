import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("collapses to its icons, each naming its view on hover, and opens again", async () => {
    const onToggle = vi.fn();
    render(<Nav route={{ view: "library" }} toDo={2} collapsed onToggle={onToggle} />);

    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(nav).toHaveClass("collapsed");
    expect(screen.getByRole("link", { name: "Radio" })).toHaveAttribute("title", "Radio");
    expect(screen.getByRole("link", { name: "Clean up, 2 names to clean up" })).toHaveAttribute(
      "title",
      "Clean up, 2 names to clean up",
    );
    const toggle = screen.getByRole("button", { name: "Show the views' names" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows each view's name beside its icon, with a way to collapse to the icons", () => {
    render(<Nav route={{ view: "library" }} collapsed={false} onToggle={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Radio" })).not.toHaveAttribute("title");
    expect(screen.getByRole("button", { name: "Show the views' names" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("offers to minimize the rail to the view shown", async () => {
    const onMinimize = vi.fn();
    render(<Nav route={{ view: "library" }} onToggle={vi.fn()} onMinimize={onMinimize} />);

    await userEvent.click(screen.getByRole("button", { name: "Minimize the rail" }));

    expect(onMinimize).toHaveBeenCalledOnce();
  });

  it("minimized, names the view shown, whose menu goes to any other", async () => {
    const onMinimize = vi.fn();
    render(<Nav route={{ view: "artist", name: "陶喆" }} minimized onMinimize={onMinimize} />);

    await userEvent.click(screen.getByRole("button", { name: "Artists: choose a view" }));

    expect(screen.getByRole("menuitem", { name: "Radio" })).toHaveAttribute("href", "#/radio");
    expect(screen.getByRole("menuitem", { name: "Artists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("minimized, shows the whole rail again", async () => {
    const onMinimize = vi.fn();
    render(<Nav route={{ view: "library" }} minimized onMinimize={onMinimize} />);

    await userEvent.click(screen.getByRole("button", { name: "Show the whole rail" }));

    expect(onMinimize).toHaveBeenCalledOnce();
  });
});

describe("the account in the rail", () => {
  it("shows who is signed in, with Sign out in its menu", async () => {
    const onSignOut = vi.fn();
    render(<Nav route={{ view: "library" }} account={{ name: "Admin", onSignOut }} />);

    await userEvent.click(screen.getByRole("button", { name: "Admin: account" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("minimized, keeps Sign out at the foot of the views' menu", async () => {
    const onSignOut = vi.fn();
    render(
      <Nav
        route={{ view: "library" }}
        minimized
        onMinimize={vi.fn()}
        account={{ name: "Admin", onSignOut }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Library: choose a view" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
