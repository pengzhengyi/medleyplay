import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Hint } from "./Hint";

/** *Next song* in the player, on Shift + →. */
function renderNextSong() {
  render(
    <Hint name="Next song" keys={["shift+right"]}>
      <button type="button" aria-label="Next song">
        ›
      </button>
    </Hint>,
  );
  return screen.getByRole("button", { name: "Next song" });
}

describe("a control's hint", () => {
  it("shows on hover what the control does, and its keys as key caps", async () => {
    const button = renderNextSong();

    await userEvent.hover(button);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Next song (Shift + →)");
    const shown = document.querySelector(".control-hint");
    expect(shown).toHaveTextContent(/^Next song/u);
    expect([...(shown?.querySelectorAll("kbd") ?? [])].map((cap) => cap.textContent)).toEqual([
      "Shift",
      "→",
    ]);
  });

  it("shows when the control is reached with the keyboard", async () => {
    renderNextSong();

    await userEvent.tab();

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Next song (Shift + →)");
  });

  it("shows a text box's on hover alone, so it never covers what is typed", async () => {
    render(
      <Hint name="Search" keys={["slash"]} showOnFocus={false}>
        <input type="search" aria-label="Search" />
      </Hint>,
    );
    const box = screen.getByRole("searchbox", { name: "Search" });

    await userEvent.tab();
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(box).toHaveFocus();
    expect(screen.queryByRole("tooltip")).toBeNull();
    await userEvent.hover(box);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Search (/)");
  });

  it("names the keys to assistive technology, with no browser tooltip besides", () => {
    const button = renderNextSong();

    expect(button).toHaveAttribute("aria-keyshortcuts", "Shift+ArrowRight");
    expect(button).not.toHaveAttribute("title");
  });

  it("is only the control's name when its command has no keys", async () => {
    render(
      <Hint name="Previous album" keys={[]}>
        <button type="button" aria-label="Previous album">
          «
        </button>
      </Hint>,
    );

    await userEvent.hover(screen.getByRole("button", { name: "Previous album" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(/^Previous album$/u);
    expect(document.querySelector(".control-hint kbd")).toBeNull();
  });

  it("shows inside the modal dialog its control is in, above the page", async () => {
    render(
      <dialog open aria-label="Now Playing">
        <Hint name="Up next" keys={["q"]}>
          <button type="button">Up next</button>
        </Hint>
      </dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Now Playing" });

    await userEvent.hover(within(dialog).getByRole("button", { name: "Up next" }));

    expect(await within(dialog).findByRole("tooltip")).toHaveTextContent("Up next (Q)");
  });
});
