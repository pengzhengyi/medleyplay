import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { applyAccent, saveColor, savedAccent, savedColors } from "../accent";
import { AccentPicker } from "./AccentPicker";
import { LanguageSelect } from "./LanguageSelect";

afterEach(() => {
  applyAccent(undefined);
  localStorage.clear();
});

describe("the accent picker", () => {
  it("translates expanded sliders and their updated values without remounting", async () => {
    render(<AccentPicker />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Pick the accent color" }));
    const hue = screen.getByRole("slider", { name: "Hue" });
    const color = screen.getByRole("slider", { name: "Color" });
    const language = render(<LanguageSelect />).getByRole("combobox", { name: "Language" });

    try {
      await user.selectOptions(language, "zh-Hans");
      expect(screen.getByRole("slider", { name: "色相" })).toBe(hue);
      expect(screen.getByRole("slider", { name: "颜色" })).toBe(color);
      const before = color.getAttribute("aria-valuetext");
      expect(before).toMatch(/饱和度.*亮度/u);
      color.focus();
      fireEvent.keyDown(color, { key: "ArrowLeft", keyCode: 37 });
      expect(color).toHaveFocus();
      await waitFor(() => {
        expect(color.getAttribute("aria-valuetext")).not.toBe(before);
        expect(color.getAttribute("aria-valuetext")).toMatch(/饱和度.*亮度/u);
      });
    } finally {
      await user.selectOptions(language, "auto");
    }
    expect(color.getAttribute("aria-valuetext")).toMatch(/^Saturation.*Brightness/u);
  });

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

describe("the colors saved to choose again", () => {
  it("saves the color shown, which then shows among them", async () => {
    applyAccent("#7a3fd1");
    render(<AccentPicker />);

    await userEvent.click(screen.getByRole("button", { name: "Save this color" }));

    const saved = screen.getByRole("list", { name: "Saved colors" });
    expect(within(saved).getByRole("button", { name: "Use #7a3fd1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save this color" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses a saved color when its tile is clicked", async () => {
    saveColor("#ffd84d");
    render(<AccentPicker />);

    await userEvent.click(screen.getByRole("button", { name: "Use #ffd84d" }));

    expect(savedAccent()).toBe("#ffd84d");
    expect(screen.getByRole("textbox", { name: "Accent color" })).toHaveValue("#ffd84d");
  });

  it("shows each tile's hex for a large tile on hover", () => {
    saveColor("#ffd84d");
    render(<AccentPicker />);

    const tile = screen.getByRole("button", { name: "Use #ffd84d" });

    expect(tile).toHaveAttribute("data-hex", "#ffd84d");
    expect(tile.style.getPropertyValue("--tile")).toBe("#ffd84d");
    expect(tile.style.getPropertyValue("--tile-ink")).toBe("#000000");
  });

  it("forgets the color shown when its heart is pressed again", async () => {
    applyAccent("#7a3fd1");
    saveColor("#7a3fd1");
    render(<AccentPicker />);

    await userEvent.click(screen.getByRole("button", { name: "Save this color" }));

    expect(savedColors()).toEqual([]);
    expect(screen.queryByRole("list", { name: "Saved colors" })).not.toBeInTheDocument();
  });
});
