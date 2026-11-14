import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openWithShortcuts } from "../testing/server";
import { setHoldForShortcuts } from "../holdForShortcuts";
import { HOLD_KEY, HOLD_MS } from "../useHeldModifier";
import { HoldForShortcuts, ShortcutList } from "./ShortcutList";

describe("the list of keyboard shortcuts", () => {
  it("names each command's keys as they are now", async () => {
    await openWithShortcuts({ toggle: ["j"], mute: [] });

    render(<ShortcutList onClose={vi.fn()} />);

    const list = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" }));
    expect(list.getByText("Play or pause").nextElementSibling).toHaveTextContent(/^J$/);
    expect(list.getByText("Next").nextElementSibling).toHaveTextContent("Shift + →");
    expect(list.getByText("Mute or unmute").nextElementSibling).toHaveTextContent("None");
  });

  it("leads to Settings to change them, closing as it goes", async () => {
    const onClose = vi.fn();
    render(<ShortcutList onClose={onClose} />);

    const link = screen.getByRole("link", { name: "Change them in Settings" });
    await userEvent.click(link);

    expect(link).toHaveAttribute("href", "#/settings");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ShortcutList onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("holding the key for the shortcuts", () => {
  afterEach(() => {
    vi.useRealTimers();
    setHoldForShortcuts(true);
  });

  const holdTheKey = () => {
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: HOLD_KEY });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
  };

  it("shows the shortcuts, with nothing to press, until the key is let go", async () => {
    await openWithShortcuts({ toggle: ["j"] });
    render(<HoldForShortcuts blocked={false} />);

    holdTheKey();

    const list = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(list).getByText("Play or pause").nextElementSibling).toHaveTextContent(/^J$/);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    act(() => {
      fireEvent.keyUp(window, { key: HOLD_KEY });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows nothing while the list's own dialog is open", () => {
    render(<HoldForShortcuts blocked />);

    holdTheKey();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows nothing once this browser turned it off", () => {
    setHoldForShortcuts(false);
    render(<HoldForShortcuts blocked={false} />);

    holdTheKey();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
