import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_RAIL_ORDER, resetRailOrder } from "../railOrder";
import { Nav } from "./Nav";
import { RailOrderSettings } from "./RailOrderSettings";

/** The views as the settings list them, in order. */
const listed = () =>
  within(screen.getByRole("list", { name: "Views in the rail" }))
    .getAllByRole("listitem")
    .map((item) => item.dataset.view);

afterEach(() => {
  resetRailOrder();
});

describe("choosing the rail's order in Settings", () => {
  it("lists the views that move, in the rail's order", () => {
    render(<RailOrderSettings />);

    expect(listed()).toEqual(DEFAULT_RAIL_ORDER);
  });

  it("moves a view up, and the rail follows", async () => {
    render(
      <>
        <Nav route={{ view: "library" }} />
        <RailOrderSettings />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Move Radio up" }));

    expect(listed()).toEqual([
      "library",
      "artists",
      "radio",
      "albums",
      "playlists",
      "downloaded",
      "insights",
    ]);
    const rail = within(screen.getByRole("navigation", { name: "Views" }));
    expect(
      rail
        .getAllByRole("link")
        .map((link) => link.textContent)
        .slice(0, 4),
    ).toEqual(["Library", "Artists", "Radio", "Albums"]);
  });

  it("moves a view down", async () => {
    render(<RailOrderSettings />);

    await userEvent.click(screen.getByRole("button", { name: "Move Library down" }));

    expect(listed().slice(0, 2)).toEqual(["artists", "library"]);
  });

  it("offers no move past either end", () => {
    render(<RailOrderSettings />);

    expect(screen.getByRole("button", { name: "Move Library up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Insights down" })).toBeDisabled();
  });

  it("goes back to the default order, offered only once the order changed", async () => {
    render(<RailOrderSettings />);
    const reset = screen.getByRole("button", { name: "Reset order" });
    expect(reset).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Move Radio up" }));
    await userEvent.click(reset);

    expect(listed()).toEqual(DEFAULT_RAIL_ORDER);
    expect(reset).toBeDisabled();
  });
});
