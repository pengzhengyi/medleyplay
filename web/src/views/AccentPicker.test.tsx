import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { applyAccent, savedAccent } from "../accent";
import { AccentPicker } from "./AccentPicker";

afterEach(() => {
  applyAccent(undefined);
  localStorage.clear();
});

describe("the accent picker", () => {
  it("shows jade until a color is chosen, with nothing to reset", () => {
    render(<AccentPicker />);

    expect(screen.getByRole("textbox", { name: "Accent color" })).toHaveValue("#0b8a70");
    expect(screen.queryByRole("button", { name: "Back to jade" })).not.toBeInTheDocument();
  });

  it("colors the page with a color typed in", async () => {
    render(<AccentPicker />);
    const field = screen.getByRole("textbox", { name: "Accent color" });

    await userEvent.clear(field);
    await userEvent.type(field, "7a3fd1");

    expect(savedAccent()).toBe("#7a3fd1");
  });

  it("opens the color square and hue slider from the swatch", async () => {
    render(<AccentPicker />);
    const swatch = screen.getByRole("button", { name: "Pick the accent color" });

    await userEvent.click(swatch);

    expect(swatch).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Hue" })).toBeInTheDocument();
  });

  it("rolls a random color", async () => {
    render(<AccentPicker random={() => 0.4} />);

    await userEvent.click(screen.getByRole("button", { name: "Random color" }));

    expect(savedAccent()).toMatch(/^#[0-9a-f]{6}$/);
    expect(screen.getByRole("textbox", { name: "Accent color" })).toHaveValue(savedAccent());
  });

  it("goes back to jade", async () => {
    applyAccent("#7a3fd1");
    render(<AccentPicker />);

    await userEvent.click(screen.getByRole("button", { name: "Back to jade" }));

    expect(savedAccent()).toBeUndefined();
    expect(screen.getByRole("textbox", { name: "Accent color" })).toHaveValue("#0b8a70");
  });
});
