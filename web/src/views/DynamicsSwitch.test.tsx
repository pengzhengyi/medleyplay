import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { chooseDynamics, savedDynamics } from "../dynamics";
import { DynamicsSwitch } from "./DynamicsSwitch";

afterEach(() => {
  chooseDynamics("flow");
  localStorage.clear();
});

describe("the Dynamics switch", () => {
  it("offers no effect or one of a few, saying what the chosen one shows", () => {
    render(<DynamicsSwitch />);

    const group = screen.getByRole("radiogroup", { name: "Dynamics" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Off", "Palette Glow", "Soft Pan", "Mesh"]);
    expect(within(group).getByRole("radio", { name: "Palette Glow" })).toBeChecked();
    expect(screen.getByText("Soft pools of color from the cover drift behind it")).toBeVisible();
  });

  it("remembers the effect chosen for this browser", async () => {
    render(<DynamicsSwitch />);

    await userEvent.click(screen.getByRole("radio", { name: "Mesh" }));

    expect(screen.getByRole("radio", { name: "Mesh" })).toBeChecked();
    expect(savedDynamics()).toBe("mesh");
  });
});
